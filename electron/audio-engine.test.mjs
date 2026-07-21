import { describe, expect, it } from 'vitest';
import engine from './audio-engine.cjs';

const { buildFilter, parseSilenceOutput } = engine;

describe('audio engine', () => {
  it('builds an overlapping anchor-aligned mix without fades', () => {
    const tracks = [
      { duration: 120, trimStart: 1, trimEnd: 2, offset: 0 },
      { duration: 90, trimStart: 0, trimEnd: 1, offset: 105.5 },
    ];
    tracks[0].sampleRate = 44100;
    tracks[1].sampleRate = 48000;
    const result = buildFilter(tracks);
    expect(result.filter).toContain('adelay=105500|105500');
    expect(result.filter).toContain('atrim=start=1:end=118');
    expect(result.filter).toContain('[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[mix]');
    expect(result.filter).not.toContain('acrossfade');
    expect(result.filter).not.toContain('concat=');
    expect(result.filter).toContain('aresample=48000:resampler=swr:filter_size=64:phase_shift=10:exact_rational=1');
    expect(result.filter).toContain('sample_fmts=dblp');
    expect(result.filter).not.toContain('loudnorm');
    expect(result.output).toBe('[mix]');
    expect(result.duration).toBe(194.5);
  });

  it('exports older projects that do not contain trim values', () => {
    const result = buildFilter([{ duration: 60, offset: 0 }]);
    expect(result.filter).toContain('atrim=start=0:end=60');
    expect(result.duration).toBe(60);
  });

  it('detects leading and trailing silence from ffmpeg output', () => {
    const log = 'Duration: 00:03:20.00\nsilence_start: 0\nsilence_end: 1.25\nsilence_start: 196.5';
    expect(parseSilenceOutput(log)).toEqual({ trimStart: 1.25, trimEnd: 3.5, duration: 200 });
  });
});
