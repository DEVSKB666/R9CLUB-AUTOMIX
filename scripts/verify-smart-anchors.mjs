import { spawnSync } from 'node:child_process';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { detectAnchorsFromEnvelope, detectBeatDriftFromEnvelope, templateEntryAnchor } from '../src/audio-analysis.js';

const sampleRate = 4000;
const frameSeconds = .05;
const frameSamples = sampleRate * frameSeconds;

let previousOffset = 0;
let previousOut = 0;
for (const [fileIndex, file] of process.argv.slice(2).entries()) {
  const result = spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1',
    '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1',
  ], { windowsHide: true, maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  const samples = new Float32Array(result.stdout.buffer, result.stdout.byteOffset, Math.floor(result.stdout.byteLength / 4));
  const envelope = [];
  for (let start = 0; start < samples.length; start += frameSamples) {
    let sum = 0;
    const end = Math.min(samples.length, start + frameSamples);
    for (let index = start; index < end; index += 1) sum += samples[index] * samples[index];
    envelope.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  const duration = samples.length / sampleRate;
  const analysis = detectAnchorsFromEnvelope(envelope, frameSeconds, duration, 136);
  const templateIn = templateEntryAnchor(136, 1, duration);
  const beatCheck = detectBeatDriftFromEnvelope(envelope, frameSeconds, 136, templateIn);
  const offset = fileIndex === 0 ? 0 : previousOffset + previousOut - templateIn;
  console.log(path.basename(file), {
    duration,
    templateIn,
    smartOut: analysis.exitAnchor,
    outConfidence: analysis.exitConfidence,
    beatDriftMs: beatCheck.beatDriftMs,
    beatConfidence: beatCheck.beatConfidence,
    outBar: analysis.exitAnchor / (4 * 60 / 136),
    startBar: offset / (4 * 60 / 136),
    linkBar: (offset + analysis.exitAnchor) / (4 * 60 / 136),
  });
  previousOffset = offset;
  previousOut = analysis.exitAnchor;
}
