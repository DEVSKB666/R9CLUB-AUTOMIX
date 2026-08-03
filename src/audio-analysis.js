function average(values, from, to) {
  let total = 0;
  const start = Math.max(0, from);
  const end = Math.min(values.length, to);
  for (let index = start; index < end; index += 1) total += values[index] || 0;
  return total / Math.max(1, end - start);
}

function smooth(values, radius) {
  const prefix = [0];
  values.forEach((value) => prefix.push(prefix.at(-1) + value));
  return values.map((_value, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length, index + radius + 1);
    return (prefix[end] - prefix[start]) / Math.max(1, end - start);
  });
}

function percentile(values, position) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * position))] || 0;
}

export function detectAnchorsFromEnvelope(envelope, frameSeconds, duration, bpm) {
  if (!envelope.length || duration < 1) return { entryAnchor: 0, exitAnchor: duration, entryConfidence: 0, exitConfidence: 0 };
  const beat = 60 / Math.max(1, bpm);
  const snapBeat = (seconds) => Math.max(0, Math.min(duration, Math.round(seconds / beat) * beat));
  const bar = beat * 4;
  const snapBar = (seconds) => Math.max(0, Math.min(duration, Math.round(seconds / bar) * bar));
  const smoothRadius = Math.max(1, Math.round(.2 / frameSeconds));
  const smoothed = smooth(envelope, smoothRadius);
  const median = percentile(smoothed, .5);
  const upper = percentile(smoothed, .75);
  const quietThreshold = Math.max(.0008, Math.min(.025, median * .18));
  const activeThreshold = Math.max(quietThreshold * 3, median * .85, upper * .6);
  const sustain = Math.max(2, Math.round(Math.max(.75, beat * 2) / frameSeconds));
  const leadingWindow = Math.max(2, Math.round(.5 / frameSeconds));
  const searchEnd = Math.min(smoothed.length - sustain, Math.round(Math.min(60, duration * .45) / frameSeconds));

  let entryIndex = 0;
  let entryConfidence = 1;
  if (average(smoothed, 0, leadingWindow) < activeThreshold) {
    entryIndex = -1;
    for (let index = 0; index < searchEnd; index += 1) {
      const after = average(smoothed, index, index + sustain);
      const before = average(smoothed, index - sustain, index);
      if (smoothed[index] >= activeThreshold * .95 && after >= activeThreshold && before < activeThreshold * .88) {
        entryIndex = index;
        entryConfidence = Math.min(1, (after - before) / Math.max(.0001, activeThreshold));
        break;
      }
    }
    if (entryIndex < 0) {
      let bestScore = 0;
      for (let index = sustain; index < searchEnd; index += 1) {
        const score = average(smoothed, index, index + sustain) - average(smoothed, index - sustain, index);
        if (score > bestScore) { bestScore = score; entryIndex = index; }
      }
      entryConfidence = Math.min(1, bestScore / Math.max(.0001, median));
      if (bestScore < median * .12) entryIndex = 0;
    }

    const onsetSearchEnd = Math.min(smoothed.length - sustain, Math.round(Math.min(duration * .45, Math.max(12, beat * 32)) / frameSeconds));
    let onsetIndex = entryIndex;
    let onsetScore = 0;
    for (let index = sustain; index < onsetSearchEnd; index += 1) {
      const score = average(smoothed, index, index + sustain) - average(smoothed, index - sustain, index);
      if (score > onsetScore) { onsetScore = score; onsetIndex = index; }
    }
    if (onsetScore >= median * .15) {
      entryIndex = Math.min(smoothed.length - 1, onsetIndex + Math.round(beat / frameSeconds));
      entryConfidence = Math.min(1, onsetScore / Math.max(.0001, median));
    }
  }

  let exitIndex = smoothed.length;
  let exitConfidence = 1;
  const tailQuiet = average(smoothed, smoothed.length - leadingWindow, smoothed.length) <= quietThreshold * 1.35;
  if (tailQuiet) {
    let lastActive = smoothed.length - 1;
    const activeFloor = quietThreshold * 1.8;
    while (lastActive > 0 && smoothed[lastActive] < activeFloor) lastActive -= 1;
    exitIndex = Math.min(smoothed.length, Math.max(0, lastActive + 1 - smoothRadius));
    const before = average(smoothed, exitIndex - sustain, exitIndex);
    const after = average(smoothed, exitIndex, exitIndex + sustain);
    exitConfidence = Math.min(1, (before - after) / Math.max(.0001, activeThreshold));
  } else {
    let bestScore = 0;
    const searchStart = Math.floor(smoothed.length * .5);
    for (let index = Math.max(sustain, searchStart); index < smoothed.length - sustain; index += 1) {
      const score = average(smoothed, index - sustain, index) - average(smoothed, index, index + sustain);
      if (score > bestScore) { bestScore = score; exitIndex = index; }
    }
    exitConfidence = Math.min(1, bestScore / Math.max(.0001, median));
    if (bestScore < median * .2) exitIndex = smoothed.length;
  }

  return {
    entryAnchor: snapBeat(entryIndex * frameSeconds),
    exitAnchor: snapBar(Math.min(duration, exitIndex * frameSeconds)),
    entryConfidence,
    exitConfidence,
  };
}

export function templateEntryAnchor(bpm, bars, duration = Infinity) {
  const seconds = Math.max(0, bars) * 4 * 60 / Math.max(1, bpm);
  return Math.min(duration, seconds);
}

// Prepared transitions share the project grid. Music-DNA tempo is metadata and
// must never move an existing IN/OUT arrangement when it is re-analysed.
export function resolveAnchorGridBpm(projectBpm) {
  const value = Number(projectBpm);
  return Number.isFinite(value) && value > 0 ? value : 120;
}

export function detectBeatDriftFromEnvelope(envelope, frameSeconds, bpm, anchorSeconds) {
  if (!envelope.length || !Number.isFinite(anchorSeconds)) return { beatDriftMs: 0, beatConfidence: 0 };
  const beatSeconds = 60 / Math.max(1, bpm);
  const center = Math.round(anchorSeconds / frameSeconds);
  const radius = Math.max(2, Math.round((beatSeconds * .45) / frameSeconds));
  const compare = Math.max(1, Math.round(.08 / frameSeconds));
  const from = Math.max(compare, center - radius);
  const to = Math.min(envelope.length - compare - 1, center + radius);
  let bestIndex = center;
  let bestScore = 0;
  const scores = [];
  for (let index = from; index <= to; index += 1) {
    const score = Math.max(0, average(envelope, index, index + compare) - average(envelope, index - compare, index));
    scores.push(score);
    if (score > bestScore) { bestScore = score; bestIndex = index; }
  }
  const signal = Math.max(.0001, percentile(envelope.slice(from, to + compare), .75));
  const noise = percentile(scores, .5);
  const beatConfidence = Math.max(0, Math.min(1, (bestScore - noise) / signal));
  if (beatConfidence < .08) return { beatDriftMs: 0, beatConfidence };
  return { beatDriftMs: Math.round((bestIndex * frameSeconds - anchorSeconds) * 1000), beatConfidence };
}
