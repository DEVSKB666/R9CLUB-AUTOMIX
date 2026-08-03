import { analyzeMusicSignal } from './music-analysis';

self.onmessage = ({ data }) => {
  const { id, signal, sampleRate } = data;
  try {
    const result = analyzeMusicSignal(new Float32Array(signal), sampleRate);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error?.message || String(error) });
  }
};
