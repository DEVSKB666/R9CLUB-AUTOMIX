const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ffmpegPath = require('ffmpeg-static');
const { buildFilter, getExportProfile } = require('../electron/audio-engine.cjs');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r9club-automix-smoke-'));
process.on('exit', () => fs.rmSync(workDir, { recursive: true, force: true }));
const first = path.join(workDir, 'first.wav');
const second = path.join(workDir, 'second.wav');
const output = path.join(workDir, 'gapless-master.wav');
const flacOutput = path.join(workDir, 'gapless-master.flac');
const mp3Output = path.join(workDir, 'gapless-listening-copy.mp3');

function ffmpeg(args) {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || `FFmpeg exited with ${result.status}`);
}

function inspect(file) {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-i', file, '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true });
  return result.stderr || '';
}

ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=44100', '-ac', '1', first]);
ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=660:duration=1.5:sample_rate=48000', '-ac', '2', second]);

const tracks = [
  { duration: 1, trimStart: 0, trimEnd: 0, offset: 0, sampleRate: 44100 },
  { duration: 1.5, trimStart: 0, trimEnd: 0, offset: 0.75, sampleRate: 48000 },
];
const engine = buildFilter(tracks);
const mp3Profile = getExportProfile({ format: 'mp3', bitrateKbps: 320 }, engine.sampleRate);
ffmpeg([
  '-i', first, '-i', second, '-filter_complex', engine.filter, '-map', engine.output,
  '-c:a', 'pcm_f32le', '-ar', String(engine.sampleRate), '-rf64', 'auto', output,
]);
ffmpeg([
  '-i', first, '-i', second, '-filter_complex', engine.filter, '-map', engine.output,
  '-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24', '-compression_level', '12',
  '-ar', String(engine.sampleRate), flacOutput,
]);
ffmpeg([
  '-i', first, '-i', second, '-filter_complex', engine.filter, '-map', engine.output,
  ...mp3Profile.codecArgs, '-ar', String(mp3Profile.sampleRate), mp3Output,
]);

const size = fs.statSync(output).size;
const flacSize = fs.statSync(flacOutput).size;
const mp3Size = fs.statSync(mp3Output).size;
if (size < 500000) throw new Error(`Unexpected output size: ${size}`);
if (flacSize < 50000) throw new Error(`Unexpected FLAC output size: ${flacSize}`);
if (mp3Size < 50000) throw new Error(`Unexpected MP3 output size: ${mp3Size}`);
const wavInfo = inspect(output);
const flacInfo = inspect(flacOutput);
const mp3Info = inspect(mp3Output);
if (!wavInfo.includes('pcm_f32le') || !wavInfo.includes('48000 Hz')) throw new Error(`Unexpected WAV format: ${wavInfo}`);
if (!flacInfo.includes('flac') || !flacInfo.includes('24 bit') || !flacInfo.includes('48000 Hz')) throw new Error(`Unexpected FLAC format: ${flacInfo}`);
if (!mp3Info.includes('Audio: mp3') || !mp3Info.includes('320 kb/s') || !mp3Info.includes('48000 Hz')) throw new Error(`Unexpected MP3 format: ${mp3Info}`);
console.log(`Audio export smoke test passed (WAV ${size} bytes, FLAC ${flacSize} bytes, MP3 ${mp3Size} bytes)`);
