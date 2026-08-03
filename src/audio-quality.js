function sampleAt(buffer, seconds) {
  if (!buffer || seconds < 0 || seconds >= buffer.duration) return 0;
  const index = Math.min(buffer.length - 1, Math.max(0, Math.floor(seconds * buffer.sampleRate)));
  let value = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) value += buffer.getChannelData(channel)[index] || 0;
  return value / Math.max(1, buffer.numberOfChannels);
}

export function inspectTrimEdges(track, buffer) {
  if (!buffer) return [];
  const warnings = [];
  const trimStart = track.trimStart || 0;
  const trimEnd = track.trimEnd || 0;
  const sampleStep = 1 / buffer.sampleRate;
  if (trimStart > 0) {
    const edge = Math.abs(sampleAt(buffer, trimStart));
    const jump = Math.abs(sampleAt(buffer, trimStart) - sampleAt(buffer, trimStart - sampleStep));
    if (edge > .1 || jump > .14) warnings.push({ type: 'click', trackId: track.id, title: `${track.name}: จุดตัดหัวเสี่ยงเกิด Click`, detail: `ระดับขอบ ${(Math.max(edge, jump) * 100).toFixed(0)}%` });
  }
  if (trimEnd > 0) {
    const end = Math.max(0, buffer.duration - trimEnd);
    const edge = Math.abs(sampleAt(buffer, end - sampleStep));
    const jump = Math.abs(sampleAt(buffer, end) - sampleAt(buffer, end - sampleStep));
    if (edge > .1 || jump > .14) warnings.push({ type: 'click', trackId: track.id, title: `${track.name}: จุดตัดท้ายเสี่ยงเกิด Click`, detail: `ระดับขอบ ${(Math.max(edge, jump) * 100).toFixed(0)}%` });
  }
  return warnings;
}

export function inspectOverlapPeak(left, right, leftBuffer, rightBuffer, samplesPerSecond = 800) {
  if (!leftBuffer || !rightBuffer) return 0;
  const leftStart = left.offset || 0;
  const rightStart = right.offset || 0;
  const leftEnd = leftStart + Math.max(0, left.duration - (left.trimStart || 0) - (left.trimEnd || 0));
  const rightEnd = rightStart + Math.max(0, right.duration - (right.trimStart || 0) - (right.trimEnd || 0));
  const from = Math.max(leftStart, rightStart);
  const to = Math.min(leftEnd, rightEnd);
  if (to <= from) return 0;
  const step = 1 / samplesPerSecond;
  let peak = 0;
  for (let time = from; time < to; time += step) {
    const leftValue = sampleAt(leftBuffer, time - leftStart + (left.trimStart || 0));
    const rightValue = sampleAt(rightBuffer, time - rightStart + (right.trimStart || 0));
    peak = Math.max(peak, Math.abs(leftValue + rightValue));
  }
  return peak;
}

export function buildQualityWarnings(tracks, buffers) {
  const warnings = [];
  tracks.forEach((track, index) => {
    if (index < tracks.length - 1 && (track.exitConfidence ?? 1) < .65) {
      warnings.push({
        type: 'anchor',
        trackId: track.id,
        title: `${track.name}: จุด OUT อัตโนมัติยังไม่ชัดเจน`,
        detail: 'OUT คือจุดส่งต่อไปเพลงถัดไป · ปรับเองได้ หรือกด Export ต่อเพื่อใช้ค่าปัจจุบัน',
      });
    }
    if ((track.beatConfidence || 0) >= .2 && Math.abs(track.beatDriftMs || 0) >= 75) {
      const direction = track.beatDriftMs > 0 ? 'ช้า' : 'เร็ว';
      warnings.push({ type: 'drift', trackId: track.id, title: `${track.name}: จังหวะ ${direction} ${Math.abs(track.beatDriftMs)} ms`, detail: 'ตรวจตำแหน่ง IN ก่อน Export' });
    }
    if ((track.clippedRatio || 0) >= .0002) {
      warnings.push({ type: 'clipping', trackId: track.id, title: `${track.name}: พบสัญญาณชน 0 dBFS`, detail: `${((track.clippedRatio || 0) * 100).toFixed(3)}% ของตัวอย่างที่ตรวจ` });
    }
    warnings.push(...inspectTrimEdges(track, buffers.get(track.id)));
  });
  for (let index = 1; index < tracks.length; index += 1) {
    const peak = inspectOverlapPeak(tracks[index - 1], tracks[index], buffers.get(tracks[index - 1].id), buffers.get(tracks[index].id));
    if (peak > 1.02) warnings.push({ type: 'clipping', trackId: tracks[index].id, title: `LINK ${index}: เสียงซ้อนอาจ Clipping`, detail: `Peak โดยประมาณ ${(20 * Math.log10(peak)).toFixed(1)} dBFS` });
  }
  return warnings;
}
