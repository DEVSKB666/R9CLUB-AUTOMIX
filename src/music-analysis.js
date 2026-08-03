import FFT from 'fft.js';

const TARGET_SAMPLE_RATE = 22050;
const FRAME_SIZE = 4096;
const HOP_SIZE = 1024;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const CAMELOT_MAJOR = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
const CAMELOT_MINOR = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const positiveModulo = (value, divisor) => ((value % divisor) + divisor) % divisor;
const mean = (values) => values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))] || 0;
}

function normalize(values) {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  return total > 1e-12 ? values.map((value) => Math.max(0, value) / total) : values.map(() => 0);
}

function cosineSimilarity(left, right) {
  const leftMean = mean(left); const rightMean = mean(right);
  let dot = 0; let leftEnergy = 0; let rightEnergy = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] - leftMean; const b = right[index] - rightMean;
    dot += a * b; leftEnergy += a * a; rightEnergy += b * b;
  }
  return dot / Math.max(1e-12, Math.sqrt(leftEnergy * rightEnergy));
}

function resampleMono(signal, sourceRate, targetRate = TARGET_SAMPLE_RATE) {
  if (!signal?.length || !sourceRate) return new Float32Array();
  if (Math.abs(sourceRate - targetRate) < 1) return Float32Array.from(signal);
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.max(1, Math.floor(signal.length / ratio)));
  if (ratio > 1) {
    for (let index = 0; index < output.length; index += 1) {
      const start = Math.floor(index * ratio); const end = Math.max(start + 1, Math.min(signal.length, Math.floor((index + 1) * ratio)));
      let sum = 0;
      for (let cursor = start; cursor < end; cursor += 1) sum += signal[cursor];
      output[index] = sum / Math.max(1, end - start);
    }
  } else {
    for (let index = 0; index < output.length; index += 1) {
      const position = index * ratio; const before = Math.floor(position); const fraction = position - before;
      output[index] = (signal[before] || 0) * (1 - fraction) + (signal[Math.min(signal.length - 1, before + 1)] || 0) * fraction;
    }
  }
  return output;
}

function correctedChroma(chroma36, tuningCents) {
  const chroma = Array(12).fill(0);
  for (let bin = 0; bin < 36; bin += 1) {
    const position = positiveModulo(bin / 3 - tuningCents / 100, 12);
    const lower = Math.floor(position); const fraction = position - lower;
    chroma[lower] += chroma36[bin] * (1 - fraction);
    chroma[(lower + 1) % 12] += chroma36[bin] * fraction;
  }
  return normalize(chroma);
}

function extractSpectralFeatures(inputSignal, inputSampleRate) {
  const signal = resampleMono(inputSignal, inputSampleRate);
  const fft = new FFT(FRAME_SIZE); const spectrum = fft.createComplexArray(); const frame = new Float64Array(FRAME_SIZE);
  const window = Float64Array.from({ length: FRAME_SIZE }, (_item, index) => .5 - .5 * Math.cos((2 * Math.PI * index) / (FRAME_SIZE - 1)));
  const binHz = TARGET_SAMPLE_RATE / FRAME_SIZE; const firstBin = Math.max(1, Math.floor(40 / binHz)); const lastBin = Math.min(FRAME_SIZE / 2 - 2, Math.ceil(5000 / binHz));
  const previous = new Float64Array(FRAME_SIZE / 2 + 1);
  const combinedFlux = []; const lowFlux = []; const midFlux = []; const highFlux = []; const energies = []; const chromaFrames36 = [];
  let tuningReal = 0; let tuningImaginary = 0;

  for (let start = 0; start < signal.length; start += HOP_SIZE) {
    let frameEnergy = 0;
    for (let index = 0; index < FRAME_SIZE; index += 1) {
      const value = signal[start + index] || 0; frame[index] = value * window[index]; frameEnergy += value * value;
    }
    fft.realTransform(spectrum, frame);
    const chroma36 = new Float32Array(36); let low = 0; let mid = 0; let high = 0; let totalFlux = 0; let frameMax = 0;
    const magnitudes = new Float64Array(lastBin + 2);
    for (let bin = firstBin; bin <= lastBin + 1; bin += 1) {
      const magnitude = Math.hypot(spectrum[bin * 2], spectrum[bin * 2 + 1]); magnitudes[bin] = magnitude; frameMax = Math.max(frameMax, magnitude);
      const logMagnitude = Math.log1p(magnitude); const difference = Math.max(0, logMagnitude - previous[bin]); previous[bin] = logMagnitude;
      const frequency = bin * binHz;
      if (frequency < 180) low += difference;
      else if (frequency < 2000) mid += difference;
      else high += difference;
      totalFlux += difference;
    }
    const peakFloor = frameMax * .012;
    for (let bin = firstBin + 1; bin <= lastBin; bin += 1) {
      const magnitude = magnitudes[bin];
      if (magnitude < peakFloor || magnitude < magnitudes[bin - 1] || magnitude <= magnitudes[bin + 1]) continue;
      const frequency = bin * binHz; const midi = 69 + 12 * Math.log2(frequency / 440); const nearest = Math.round(midi);
      const cents = (midi - nearest) * 100; const tuningWeight = Math.sqrt(magnitude) * Math.min(1, frequency / 160);
      tuningReal += Math.cos((cents / 100) * Math.PI * 2) * tuningWeight;
      tuningImaginary += Math.sin((cents / 100) * Math.PI * 2) * tuningWeight;
      const pitchPosition = positiveModulo(midi, 12) * 3; const lower = Math.floor(pitchPosition); const fraction = pitchPosition - lower;
      const weight = Math.sqrt(magnitude) / Math.sqrt(Math.max(80, frequency));
      chroma36[positiveModulo(lower, 36)] += weight * (1 - fraction);
      chroma36[positiveModulo(lower + 1, 36)] += weight * fraction;
    }
    combinedFlux.push(totalFlux / Math.max(1, lastBin - firstBin));
    lowFlux.push(low); midFlux.push(mid); highFlux.push(high); energies.push(frameEnergy / FRAME_SIZE); chromaFrames36.push(chroma36);
    if (start + FRAME_SIZE >= signal.length) break;
  }
  let tuningCents = Math.atan2(tuningImaginary, tuningReal) * 100 / (2 * Math.PI);
  if (tuningCents > 50) tuningCents -= 100;
  if (tuningCents < -50) tuningCents += 100;
  const chromaFrames = chromaFrames36.map((chroma) => correctedChroma(chroma, tuningCents));
  return { combinedFlux, lowFlux, midFlux, highFlux, energies, chromaFrames, tuningCents, sampleRate: TARGET_SAMPLE_RATE, frameRate: TARGET_SAMPLE_RATE / HOP_SIZE, duration: signal.length / TARGET_SAMPLE_RATE };
}

function noveltyCurve(values) {
  const radius = 10; const prefix = [0]; values.forEach((value) => prefix.push(prefix.at(-1) + value));
  const novelty = values.map((value, index) => {
    const from = Math.max(0, index - radius); const to = Math.min(values.length, index + radius + 1);
    const localMean = (prefix[to] - prefix[from]) / Math.max(1, to - from);
    return Math.max(0, value - localMean * .72);
  });
  const scale = percentile(novelty, .9) || 1;
  return novelty.map((value) => Math.min(4, value / scale));
}

function interpolated(values, position) {
  const before = Math.floor(position); const fraction = position - before;
  return (values[before] || 0) * (1 - fraction) + (values[before + 1] || 0) * fraction;
}

function correlationAtLag(values, lag) {
  const start = Math.ceil(lag); const count = Math.max(1, values.length - start); let leftMean = 0; let rightMean = 0;
  for (let index = start; index < values.length; index += 1) { leftMean += values[index]; rightMean += interpolated(values, index - lag); }
  leftMean /= count; rightMean /= count;
  let dot = 0; let leftEnergy = 0; let rightEnergy = 0;
  for (let index = start; index < values.length; index += 1) {
    const left = values[index] - leftMean; const right = interpolated(values, index - lag) - rightMean;
    dot += left * right; leftEnergy += left * left; rightEnergy += right * right;
  }
  return dot / Math.max(1e-9, Math.sqrt(leftEnergy * rightEnergy));
}

function detectTempo(features) {
  const curves = [features.combinedFlux, features.lowFlux, features.midFlux, features.highFlux].map(noveltyCurve);
  const cache = new Map();
  const scoreTempo = (bpm) => {
    const lag = 60 * features.frameRate / bpm; const cacheKey = lag.toFixed(4);
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const weights = [.5, .23, .18, .09];
    let score = 0; curves.forEach((curve, index) => { score += correlationAtLag(curve, lag) * weights[index]; });
    if (lag * 2 < curves[0].length / 3) score += correlationAtLag(curves[0], lag * 2) * .18;
    if (bpm >= 82 && bpm <= 178) score += .025;
    if (bpm > 190) score -= .025;
    cache.set(cacheKey, score); return score;
  };
  const scanned = [];
  for (let bpm = 55; bpm <= 210; bpm += .25) scanned.push({ bpm, score: scoreTempo(bpm) });
  const peaks = scanned.filter((item, index) => index > 0 && index < scanned.length - 1 && item.score >= scanned[index - 1].score && item.score > scanned[index + 1].score).sort((a, b) => b.score - a.score);
  const candidates = [];
  for (const candidate of peaks) {
    if (candidates.some((item) => Math.abs(item.bpm - candidate.bpm) < 2)) continue;
    candidates.push(candidate); if (candidates.length >= 8) break;
  }
  const best = candidates[0] || { bpm: 0, score: 0 }; const runner = candidates.find((item) => Math.abs(item.bpm - best.bpm) > 4) || { score: 0 };
  const harmonic = candidates.find((item) => Math.abs(item.bpm * 2 - best.bpm) < 2 || Math.abs(item.bpm - best.bpm * 2) < 2);
  const margin = best.score - Math.max(runner.score, harmonic ? harmonic.score * .92 : 0);
  const harmonicAmbiguity = Boolean(harmonic && harmonic.score >= best.score * .88);
  const confidence = Math.min(harmonicAmbiguity ? .78 : 1, clamp((best.score - .12) * 1.8 + margin * 2.5));

  const onset = curves[0]; const lag = best.bpm ? 60 * features.frameRate / best.bpm : features.frameRate / 2;
  let bestPhase = 0; let bestPhaseScore = -Infinity;
  for (let phase = 0; phase < lag; phase += .2) {
    let score = 0; for (let position = phase; position < onset.length; position += lag) score += interpolated(onset, position);
    if (score > bestPhaseScore) { bestPhaseScore = score; bestPhase = phase; }
  }
  const beats = []; let previousBeat = -Infinity;
  for (let position = bestPhase; position < onset.length; position += lag) {
    let refined = Math.round(position); let value = -Infinity;
    for (let cursor = Math.max(0, Math.round(position) - 2); cursor <= Math.min(onset.length - 1, Math.round(position) + 2); cursor += 1) {
      if (onset[cursor] > value) { value = onset[cursor]; refined = cursor; }
    }
    const seconds = refined / features.frameRate;
    if (seconds - previousBeat >= (60 / Math.max(1, best.bpm)) * .55) { beats.push(seconds); previousBeat = seconds; }
  }
  return {
    bpm: Math.round(best.bpm * 100) / 100,
    confidence,
    harmonicAmbiguity,
    beats,
    candidates: candidates.slice(0, 4).map((item) => ({ bpm: Math.round(item.bpm * 100) / 100, score: clamp(item.score) })),
  };
}

function rotateProfile(profile, root) {
  return profile.map((_value, index) => profile[positiveModulo(index - root, 12)]);
}

function estimateKey(chroma) {
  const normalizedChroma = normalize(chroma); const candidates = [];
  for (let root = 0; root < 12; root += 1) {
    candidates.push({ root, scale: 'major', score: cosineSimilarity(normalizedChroma, rotateProfile(MAJOR_PROFILE, root)) });
    candidates.push({ root, scale: 'minor', score: cosineSimilarity(normalizedChroma, rotateProfile(MINOR_PROFILE, root)) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]; const second = candidates[1]; const margin = best.score - second.score;
  const confidence = clamp((best.score - .35) * 1.15 + margin * 2.8);
  const decorate = (candidate) => ({
    key: NOTE_NAMES[candidate.root], scale: candidate.scale,
    label: `${NOTE_NAMES[candidate.root]} ${candidate.scale === 'major' ? 'Major' : 'Minor'}`,
    camelot: candidate.scale === 'major' ? CAMELOT_MAJOR[candidate.root] : CAMELOT_MINOR[candidate.root],
    score: clamp((candidate.score + 1) / 2),
  });
  return { ...decorate(best), confidence, candidates: candidates.slice(0, 5).map(decorate) };
}

function aggregateChroma(features, fromFrame = 0, toFrame = features.chromaFrames.length) {
  const energyFloor = percentile(features.energies.slice(fromFrame, toFrame), .2); const output = Array(12).fill(0); let used = 0;
  for (let index = fromFrame; index < toFrame; index += 1) {
    if ((features.energies[index] || 0) <= energyFloor) continue;
    const frame = features.chromaFrames[index]; const weight = Math.sqrt(features.energies[index] || 0);
    frame.forEach((value, pitch) => { output[pitch] += value * weight; }); used += 1;
  }
  return { chroma: normalize(output), used };
}

function chordCandidates(chroma, keyResult) {
  const normalized = normalize(chroma); const candidates = [];
  const types = [
    { suffix: '', intervals: [0, 4, 7], penalty: 0 },
    { suffix: 'm', intervals: [0, 3, 7], penalty: 0 },
    { suffix: '7', intervals: [0, 4, 7, 10], penalty: .035 },
    { suffix: 'maj7', intervals: [0, 4, 7, 11], penalty: .045 },
    { suffix: 'm7', intervals: [0, 3, 7, 10], penalty: .04 },
    { suffix: 'sus2', intervals: [0, 2, 7], penalty: .025 },
    { suffix: 'sus4', intervals: [0, 5, 7], penalty: .025 },
    { suffix: 'dim', intervals: [0, 3, 6], penalty: .03 },
  ];
  const keyRoot = NOTE_NAMES.indexOf(keyResult.key);
  const diatonic = keyResult.scale === 'major'
    ? new Map([[0, ['']], [2, ['m', 'm7']], [4, ['m', 'm7']], [5, ['', 'maj7']], [7, ['', '7']], [9, ['m', 'm7']], [11, ['dim']]])
    : new Map([[0, ['m', 'm7']], [2, ['dim']], [3, ['', 'maj7']], [5, ['m', 'm7']], [7, ['m', '', '7']], [8, ['', 'maj7']], [10, ['', '7']]]);
  for (let root = 0; root < 12; root += 1) {
    for (const type of types) {
      const tones = new Set(type.intervals.map((interval) => (root + interval) % 12)); let inside = 0; let outside = 0;
      normalized.forEach((value, pitch) => { if (tones.has(pitch)) inside += value; else outside += value; });
      let score = inside - outside * .42 - type.penalty;
      const degree = positiveModulo(root - keyRoot, 12); const allowedQualities = diatonic.get(degree);
      score += allowedQualities?.includes(type.suffix) ? .055 : -.012;
      if (root === keyRoot) score += .025;
      candidates.push({ label: `${NOTE_NAMES[root]}${type.suffix}`, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score); return candidates;
}

function detectChords(features, tempo, keyResult) {
  const boundaries = tempo.beats.length >= 4 ? tempo.beats : Array.from({ length: Math.ceil(features.duration / 2) + 1 }, (_item, index) => index * 2);
  const raw = [];
  for (let index = 0; index < boundaries.length - 1; index += 2) {
    const start = boundaries[index]; const end = boundaries[Math.min(boundaries.length - 1, index + 2)];
    const fromFrame = Math.max(0, Math.floor(start * features.frameRate)); const toFrame = Math.min(features.chromaFrames.length, Math.ceil(end * features.frameRate));
    const aggregate = aggregateChroma(features, fromFrame, toFrame); const candidates = chordCandidates(aggregate.chroma, keyResult);
    const confidence = clamp((candidates[0].score - candidates[1].score) * 3.5 + (candidates[0].score - .25));
    raw.push({ start, end, label: confidence >= .16 ? candidates[0].label : 'N', confidence });
  }
  const smoothed = raw.map((item, index) => {
    if (!raw[index - 1] || !raw[index + 1] || raw[index - 1].label !== raw[index + 1].label || item.confidence >= .48) return item;
    return { ...item, label: raw[index - 1].label, confidence: Math.min(raw[index - 1].confidence, raw[index + 1].confidence) };
  });
  const events = [];
  smoothed.forEach((item) => {
    const previous = events.at(-1);
    if (previous?.label === item.label) { previous.end = item.end; previous.confidence = (previous.confidence + item.confidence) / 2; }
    else events.push({ ...item });
  });
  return events.filter((event) => event.label !== 'N').map((event) => ({ ...event, start: Math.round(event.start * 100) / 100, end: Math.round(event.end * 100) / 100, confidence: Math.round(event.confidence * 100) / 100 }));
}

function detectKeyChanges(features, tempo, globalKey) {
  const segmentSeconds = Math.max(20, tempo.bpm ? 32 * 60 / tempo.bpm : 20); const changes = [];
  for (let start = 0; start < features.duration; start += segmentSeconds) {
    const fromFrame = Math.floor(start * features.frameRate); const toFrame = Math.min(features.chromaFrames.length, Math.ceil((start + segmentSeconds) * features.frameRate));
    const aggregate = aggregateChroma(features, fromFrame, toFrame); if (aggregate.used < 4) continue;
    const key = estimateKey(aggregate.chroma);
    if (key.confidence >= .45 && key.label !== globalKey.label) changes.push({ start: Math.round(start * 10) / 10, end: Math.round(Math.min(features.duration, start + segmentSeconds) * 10) / 10, label: key.label, camelot: key.camelot, confidence: Math.round(key.confidence * 100) / 100 });
  }
  return changes;
}

export function analyzeMusicSignal(signal, sampleRate) {
  const features = extractSpectralFeatures(signal, sampleRate); const tempo = detectTempo(features);
  const aggregate = aggregateChroma(features); const key = estimateKey(aggregate.chroma);
  const chords = detectChords(features, tempo, key); const keyChanges = detectKeyChanges(features, tempo, key);
  return {
    version: 1,
    bpm: tempo.bpm,
    bpmConfidence: Math.round(tempo.confidence * 100) / 100,
    bpmAmbiguous: tempo.harmonicAmbiguity,
    bpmCandidates: tempo.candidates,
    beatTimes: tempo.beats.map((time) => Math.round(time * 1000) / 1000),
    key: key.key,
    scale: key.scale,
    keyLabel: key.label,
    camelot: key.camelot,
    keyConfidence: Math.round(key.confidence * 100) / 100,
    keyCandidates: key.candidates,
    tuningCents: Math.round(features.tuningCents * 10) / 10,
    tuningFrequency: Math.round(440 * (2 ** (features.tuningCents / 1200)) * 10) / 10,
    chords,
    keyChanges,
    duration: features.duration,
  };
}

export const musicTheory = { NOTE_NAMES, CAMELOT_MAJOR, CAMELOT_MINOR };
