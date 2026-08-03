import { describe, expect, it } from 'vitest';
import { buildQualityWarnings, inspectOverlapPeak, inspectTrimEdges } from './audio-quality';

function fakeBuffer(values, sampleRate = 10) {
  const channel = Float32Array.from(values);
  return { duration: channel.length / sampleRate, length: channel.length, sampleRate, numberOfChannels: 1, getChannelData: () => channel };
}

describe('audio quality checks', () => {
  it('flags a trim on a non-zero waveform edge', () => {
    const warnings = inspectTrimEdges({ id: 'a', name: 'A', trimStart: .2, trimEnd: 0 }, fakeBuffer([0, 0, .8, .7, 0]));
    expect(warnings[0].type).toBe('click');
  });

  it('estimates clipping inside an overlap', () => {
    const buffer = fakeBuffer(Array.from({ length: 20 }, () => .7));
    const left = { duration: 2, offset: 0, trimStart: 0, trimEnd: 0 };
    const right = { duration: 2, offset: 1, trimStart: 0, trimEnd: 0 };
    expect(inspectOverlapPeak(left, right, buffer, buffer, 10)).toBeCloseTo(1.4, 3);
  });

  it('collects beat drift and source clipping warnings', () => {
    const track = { id: 'a', name: 'A', duration: 2, offset: 0, beatDriftMs: 90, beatConfidence: .8, clippedRatio: .01 };
    const warnings = buildQualityWarnings([track], new Map([['a', fakeBuffer(Array.from({ length: 20 }, () => 0))]]));
    expect(warnings.map((warning) => warning.type)).toEqual(['drift', 'clipping']);
  });

  it('treats an uncertain OUT as a warning instead of a render blocker', () => {
    const tracks = [
      { id: 'a', name: 'A', duration: 2, offset: 0, exitAnchor: 1.5, exitConfidence: .2 },
      { id: 'b', name: 'B', duration: 2, offset: 1.5 },
    ];
    const buffers = new Map([
      ['a', fakeBuffer(Array.from({ length: 20 }, () => 0))],
      ['b', fakeBuffer(Array.from({ length: 20 }, () => 0))],
    ]);
    const warnings = buildQualityWarnings(tracks, buffers);
    expect(warnings.map((warning) => warning.type)).toEqual(['anchor']);
    expect(warnings[0].detail).toContain('Export ต่อ');
  });
});
