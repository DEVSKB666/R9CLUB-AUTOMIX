const { spawnSync } = require('node:child_process');
const path = require('node:path');
const ffmpegPath = require('ffmpeg-static');

const files = process.argv.slice(2);
if (!files.length) throw new Error('Pass one or more audio files');

const sampleRate = 4000;
const frameSeconds = 0.1;
const frameSamples = sampleRate * frameSeconds;

function average(values, from, to) {
  let total = 0;
  for (let index = from; index < to; index += 1) total += values[index] || 0;
  return total / Math.max(1, to - from);
}

function analyze(file) {
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
  const sorted = [...envelope].sort((a, b) => a - b);
  const percentile = (value) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))];
  const window = Math.round(2 / frameSeconds);
  const candidates = [];
  for (let index = window; index < envelope.length - window; index += 1) {
    const before = average(envelope, index - window, index);
    const after = average(envelope, index, index + window);
    candidates.push({ time: index * frameSeconds, rise: after - before, fall: before - after, before, after });
  }
  const pick = (key) => {
    const picked = [];
    for (const candidate of [...candidates].sort((a, b) => b[key] - a[key])) {
      if (picked.every((item) => Math.abs(item.time - candidate.time) > 5)) picked.push(candidate);
      if (picked.length === 8) break;
    }
    return picked.map((item) => ({
      time: item.time.toFixed(2),
      score: item[key].toFixed(4),
      beforeDb: (20 * Math.log10(item.before + 1e-7)).toFixed(1),
      afterDb: (20 * Math.log10(item.after + 1e-7)).toFixed(1),
    }));
  };
  const bpm = 136;
  const smartWindow = Math.max(2, Math.round(Math.max(.75, (60 / bpm) * 2) / frameSeconds));
  const smartSearch = Math.min(Math.floor(45 / frameSeconds), Math.floor(envelope.length * .4));
  let entryIndex = 0; let entryScore = 0;
  for (let index = smartWindow; index < Math.max(smartWindow, smartSearch - smartWindow); index += 1) {
    const score = average(envelope, index, index + smartWindow) - average(envelope, index - smartWindow, index);
    if (score > entryScore) { entryScore = score; entryIndex = index; }
  }
  let exitIndex = envelope.length; let exitScore = 0;
  for (let index = Math.max(smartWindow, envelope.length - smartSearch); index < envelope.length - smartWindow; index += 1) {
    const score = average(envelope, index - smartWindow, index) - average(envelope, index, index + smartWindow);
    if (score > exitScore) { exitScore = score; exitIndex = index; }
  }
  const beat = 60 / bpm;
  const snap = (seconds) => Math.round(seconds / beat) * beat;
  return {
    file: path.basename(file),
    duration: (samples.length / sampleRate).toFixed(2),
    p10Db: (20 * Math.log10(percentile(.1) + 1e-7)).toFixed(1),
    p50Db: (20 * Math.log10(percentile(.5) + 1e-7)).toFixed(1),
    p90Db: (20 * Math.log10(percentile(.9) + 1e-7)).toFixed(1),
    currentDetector: {
      entry: (entryScore > .045 ? snap(entryIndex * frameSeconds) : 0).toFixed(3),
      entryScore: entryScore.toFixed(4),
      exit: (exitScore > .045 ? snap(exitIndex * frameSeconds) : samples.length / sampleRate).toFixed(3),
      exitScore: exitScore.toFixed(4),
    },
    rises: pick('rise'),
    falls: pick('fall'),
  };
}

for (const file of files) console.log(JSON.stringify(analyze(file), null, 2));
