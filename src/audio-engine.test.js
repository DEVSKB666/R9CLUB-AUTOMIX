import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { estimatePcmBytes, parseRenderVerification } = require('../electron/audio-engine.cjs');

describe('lossless render safeguards', () => {
  it('estimates stereo 32-bit float PCM storage including the WAV header', () => {
    expect(estimatePcmBytes(60, 48000)).toBe(23_040_114);
  });

  it('accepts a matching FFmpeg verification report', () => {
    const output = `
      Duration: 00:03:20.04, bitrate: 3072 kb/s
      Stream #0:0: Audio: pcm_f32le ([3][0][0][0] / 0x0003), 48000 Hz, stereo, flt, 3072 kb/s
      [Parsed_astats_0 @ 000] Peak level dB: -0.843201
    `;
    const result = parseRenderVerification(output, { codec: 'pcm_f32le', sampleRate: 48000, channels: 2, duration: 200 });
    expect(result.passed).toBe(true);
    expect(result.sampleCount).toBe(9_601_920);
    expect(result.peakDb).toBeCloseTo(-0.843201, 5);
  });

  it('rejects a lossy or wrong-rate output', () => {
    const output = 'Duration: 00:01:00.00\nStream #0:0: Audio: mp3, 44100 Hz, stereo, fltp';
    const result = parseRenderVerification(output, { codec: 'pcm_f32le', sampleRate: 48000, channels: 2, duration: 60 });
    expect(result.passed).toBe(false);
    expect(result.checks.codec).toBe(false);
    expect(result.checks.sampleRate).toBe(false);
  });
});
