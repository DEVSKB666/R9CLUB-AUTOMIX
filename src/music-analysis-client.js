import { analyzeMusicSignal } from './music-analysis';

let worker;
let requestId = 0;
let workerBusy = false;
const pending = new Map();
const queue = [];

function pumpQueue() {
  if (workerBusy || !worker || !queue.length) return;
  const task = queue.shift(); const signal = downmix(task.buffer); workerBusy = true;
  pending.set(task.id, { resolve: task.resolve, reject: task.reject });
  worker.postMessage({ id: task.id, signal: signal.buffer, sampleRate: task.buffer.sampleRate }, [signal.buffer]);
}

function getWorker() {
  if (worker || typeof Worker === 'undefined') return worker;
  worker = new Worker(new URL('./music-analysis.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id); if (!request) return;
    pending.delete(data.id);
    workerBusy = false;
    if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result);
    pumpQueue();
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Music analysis worker stopped');
    pending.forEach(({ reject }) => reject(error)); queue.splice(0).forEach(({ reject }) => reject(error)); pending.clear(); workerBusy = false; worker?.terminate(); worker = undefined;
  };
  return worker;
}

function downmix(buffer) {
  const output = new Float32Array(buffer.length); const channels = Math.min(2, buffer.numberOfChannels);
  for (let channel = 0; channel < channels; channel += 1) {
    const input = buffer.getChannelData(channel);
    for (let index = 0; index < output.length; index += 1) output[index] += input[index] / channels;
  }
  return output;
}

export function analyzeMusicBuffer(buffer) {
  const activeWorker = getWorker();
  if (!activeWorker) return Promise.resolve(analyzeMusicSignal(downmix(buffer), buffer.sampleRate));
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    queue.push({ id, buffer, resolve, reject });
    pumpQueue();
  });
}
