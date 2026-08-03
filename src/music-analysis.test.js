import { describe, expect, it } from 'vitest';
import { analyzeMusicSignal } from './music-analysis';

const sampleRate = 22050;
const noteFrequency = (midi, cents = 0) => 440 * (2 ** ((midi - 69 + cents / 100) / 12));

function synthesizeProgression({ bpm, chordMidis, duration = 20, tuningCents = 0 }) {
  const signal = new Float32Array(Math.floor(sampleRate * duration));
  const sectionDuration = duration / chordMidis.length;
  for (let index = 0; index < signal.length; index += 1) {
    const seconds = index / sampleRate;
    const chord = chordMidis[Math.min(chordMidis.length - 1, Math.floor(seconds / sectionDuration))];
    for (const midi of chord) {
      const frequency = noteFrequency(midi, tuningCents);
      signal[index] += Math.sin(2 * Math.PI * frequency * seconds) * .075;
      signal[index] += Math.sin(4 * Math.PI * frequency * seconds) * .018;
    }
  }
  const beatSeconds = 60 / bpm;
  for (let seconds = 0; seconds < duration; seconds += beatSeconds) {
    const start = Math.floor(seconds * sampleRate);
    for (let index = 0; index < 1000 && start + index < signal.length; index += 1) {
      const envelope = Math.exp(-index / 190);
      signal[start + index] += Math.sin(2 * Math.PI * 72 * index / sampleRate) * envelope * .72;
      signal[start + index] += Math.sin(2 * Math.PI * 1800 * index / sampleRate) * envelope * .08;
    }
  }
  return signal;
}

describe('high-confidence music analysis', () => {
  it('detects tempo, key and a beat-aligned major chord progression', () => {
    const signal = synthesizeProgression({
      bpm: 128,
      chordMidis: [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]],
      duration: 24,
    });
    const result = analyzeMusicSignal(signal, sampleRate);
    expect(result.bpm).toBeCloseTo(128, 0);
    expect(result.bpmCandidates.map((candidate) => candidate.bpm)).toContain(64);
    expect(result.bpmAmbiguous).toBe(true);
    expect(result.keyLabel).toBe('C Major');
    expect(result.camelot).toBe('8B');
    expect(result.chords.map((chord) => chord.label)).toEqual(expect.arrayContaining(['C', 'F', 'G']));
  });

  it('detects a minor key and reports tuning instead of assuming A=440', () => {
    const signal = synthesizeProgression({
      bpm: 120,
      chordMidis: [[57, 60, 64], [62, 65, 69], [64, 68, 71], [57, 60, 64]],
      tuningCents: 18,
    });
    const result = analyzeMusicSignal(signal, sampleRate);
    expect(result.bpm).toBeCloseTo(120, 0);
    expect(result.keyLabel).toBe('A Minor');
    expect(result.camelot).toBe('8A');
    expect(result.tuningCents).toBeGreaterThan(8);
    expect(result.tuningCents).toBeLessThan(28);
    expect(result.chords.map((chord) => chord.label)).toEqual(expect.arrayContaining(['Am', 'Dm', 'E7']));
  });

  it('does not report random noise as a verified tempo or chord sequence', () => {
    let seed = 17;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    const signal = Float32Array.from({ length: sampleRate * 12 }, () => random() * .15);
    const result = analyzeMusicSignal(signal, sampleRate);
    expect(result.bpmConfidence).toBeLessThan(.45);
    expect(result.keyConfidence).toBeLessThan(.3);
    expect(result.chords).toHaveLength(0);
  });
});
