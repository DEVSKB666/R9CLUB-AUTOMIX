import { describe, expect, it } from 'vitest';
import { detectAnchorsFromEnvelope, detectBeatDriftFromEnvelope, templateEntryAnchor } from './audio-analysis';

describe('smart anchor detector', () => {
  it('finds a prepared fade-in and a sustained silent tail', () => {
    const frameSeconds = .1;
    const values = Array.from({ length: 2630 }, (_item, index) => {
      if (index < 20) return index / 70;
      if (index >= 2560) return .002;
      return .34 + Math.sin(index * .13) * .05;
    });
    const result = detectAnchorsFromEnvelope(values, frameSeconds, 263, 136);
    expect(result.entryAnchor).toBeCloseTo(1.765, 2);
    expect(result.exitAnchor).toBeCloseTo(255.882, 2);
  });

  it('searches the full file when the silent tail is unusually long', () => {
    const values = Array.from({ length: 2000 }, (_item, index) => index < 1200 ? .3 : .001);
    const result = detectAnchorsFromEnvelope(values, .1, 200, 120);
    expect(result.exitAnchor).toBe(120);
  });

  it('keeps full-level files edge aligned', () => {
    const values = Array.from({ length: 1000 }, () => .3);
    const result = detectAnchorsFromEnvelope(values, .1, 100, 120);
    expect(result.entryAnchor).toBe(0);
    expect(result.exitAnchor).toBe(100);
  });

  it('uses the deterministic shared intro template for prepared files', () => {
    expect(templateEntryAnchor(136, 1)).toBeCloseTo(1.764705882, 8);
    expect(templateEntryAnchor(136, 2)).toBeCloseTo(3.529411765, 8);
    expect(templateEntryAnchor(136, 4, 3)).toBe(3);
  });

  it('measures a strong onset that drifts away from the prepared beat', () => {
    const envelope = Array.from({ length: 200 }, (_item, index) => index < 52 ? .04 : .7);
    const result = detectBeatDriftFromEnvelope(envelope, .02, 120, 1);
    expect(result.beatDriftMs).toBeCloseTo(40, -1);
    expect(result.beatConfidence).toBeGreaterThan(.5);
  });

  it('does not invent drift when no onset is present', () => {
    const result = detectBeatDriftFromEnvelope(Array.from({ length: 200 }, () => .2), .02, 120, 1);
    expect(result.beatDriftMs).toBe(0);
    expect(result.beatConfidence).toBe(0);
  });
});
