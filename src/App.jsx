import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowDown, ArrowUp, AudioLines, Check, Download, FileAudio,
  FolderOpen, Gauge, HardDrive, Headphones, History, Keyboard, Link2, ListMusic, Music2, Pause, Play, Plus,
  Redo2, RefreshCw, Repeat2, RotateCcw, Save, Scissors, ShieldCheck, SkipBack, SkipForward,
  Trash2, TriangleAlert, Undo2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { detectAnchorsFromEnvelope, detectBeatDriftFromEnvelope, templateEntryAnchor } from './audio-analysis';
import { buildQualityWarnings } from './audio-quality';
import { analyzeMusicBuffer } from './music-analysis-client';
import { musicTheory } from './music-analysis';
import r9Logo from './assets/r9club-logo.png';

const api = window.beatBlend;
const desktopPlatform = api?.platform || 'web';
const colors = ['#56c7e8', '#efa94a', '#69d39b', '#ee7b7b', '#b39bea', '#e6d35f'];
const exportFormats = [
  { value: 'wav', label: 'WAV', quality: '32-bit Float PCM', detail: 'Lossless Master · คุณภาพสูงสุด', lossless: true },
  { value: 'flac', label: 'FLAC', quality: '24-bit PCM', detail: 'Lossless · ไฟล์เล็กกว่า WAV', lossless: true },
  { value: 'mp3', label: 'MP3', quality: 'CBR', detail: 'ไฟล์สำหรับฟังและส่งต่อ', lossless: false },
];
const mp3Bitrates = [128, 192, 256, 320];
const keyChoices = musicTheory.NOTE_NAMES.flatMap((key, root) => [
  { value: `${key}|major`, label: `${key} Major`, camelot: musicTheory.CAMELOT_MAJOR[root] },
  { value: `${key}|minor`, label: `${key} Minor`, camelot: musicTheory.CAMELOT_MINOR[root] },
]);
const shortcuts = [
  ['เล่น / หยุดชั่วคราว', 'Space'],
  ['หยุดเล่น', 'Esc'],
  ['กลับจุดเริ่มต้น', 'Home'],
  ['เลื่อน 1 ห้อง', '← / →'],
  ['เลื่อน 4 ห้อง', 'Shift + ← / →'],
  ['Zoom Timeline', '+ / -'],
  ['Zoom ตรงตำแหน่งเมาส์', 'Ctrl + Wheel'],
  ['ทดลองช่วงเชื่อมแบบวน', 'L'],
  ['ย้อนกลับ', 'Ctrl + Z'],
  ['ทำซ้ำ', 'Ctrl + Y'],
  ['เพิ่มเพลง', 'Ctrl + Shift + O'],
  ['เปิดโปรเจกต์', 'Ctrl + O'],
  ['บันทึกโปรเจกต์', 'Ctrl + S'],
  ['Export Mix', 'Ctrl + E'],
  ['ลบเพลงที่เลือก', 'Delete'],
  ['แสดงคำสั่งลัด', '?'],
];

const demoSeed = [
  { name: 'Midnight Drive', duration: 224.8, entryAnchor: 0, exitAnchor: 205 },
  { name: 'Neon Skyline', duration: 198.2, entryAnchor: 20, exitAnchor: 181 },
  { name: 'Afterglow', duration: 236.6, entryAnchor: 17, exitAnchor: 218 },
];

const playableDuration = (track) => Math.max(0, track.duration - (track.trimStart || 0) - (track.trimEnd || 0));
const anchorIn = (track) => Math.max(0, (track.entryAnchor || 0) - (track.trimStart || 0));
const anchorOut = (track) => Math.max(0, (track.exitAnchor || track.duration) - (track.trimStart || 0));

function alignTracks(tracks) {
  if (!tracks.length) return [];
  const aligned = tracks.map((track) => ({ ...track }));
  aligned[0].offset = 0;
  for (let index = 1; index < aligned.length; index += 1) {
    const previous = aligned[index - 1];
    const transition = previous.offset + Math.min(playableDuration(previous), anchorOut(previous));
    aligned[index].offset = Math.max(previous.offset, transition - Math.min(playableDuration(aligned[index]), anchorIn(aligned[index])));
  }
  return aligned;
}

const demoTracks = alignTracks(demoSeed.map((item, index) => ({
  ...item, id: `demo-${index}`, path: '', sourceUrl: '', trimStart: 0,
  trimEnd: 0, color: colors[index], peaks: null, entryConfidence: 1, exitConfidence: 1,
})));

function formatTime(seconds = 0, precise = false) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const value = precise ? (safe % 60).toFixed(1).padStart(4, '0') : String(Math.floor(safe % 60)).padStart(2, '0');
  return `${minutes}:${value}`;
}

function mp3SampleRateFor(sourceSampleRate) {
  if (sourceSampleRate <= 48000) return sourceSampleRate === 44100 ? 44100 : 48000;
  return sourceSampleRate % 44100 === 0 ? 44100 : 48000;
}

function estimateExportBytes(duration, sampleRate, format, bitrateKbps) {
  const safeDuration = Math.max(0, duration);
  if (format === 'mp3') return Math.ceil(safeDuration * bitrateKbps * 1000 / 8) + 128 * 1024;
  const bytesPerSample = format === 'flac' ? 3 : 4;
  return Math.ceil(safeDuration * Math.max(1, sampleRate)) * 2 * bytesPerSample + (format === 'flac' ? 128 * 1024 : 114);
}

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
  return `${(bytes / 1048576).toFixed(bytes >= 104857600 ? 0 : 1)} MB`;
}

function preserveManualMusicAnalysis(detected, saved) {
  if (!detected) return saved || null;
  const merged = { ...detected };
  if (saved?.bpmSource === 'manual') Object.assign(merged, { bpm: saved.bpm, bpmConfidence: 1, bpmAmbiguous: false, bpmSource: 'manual' });
  if (saved?.keySource === 'manual') Object.assign(merged, { key: saved.key, scale: saved.scale, keyLabel: saved.keyLabel, camelot: saved.camelot, keyConfidence: 1, keySource: 'manual' });
  if (saved?.chords?.some((chord) => chord.source === 'manual')) merged.chords = saved.chords;
  return merged;
}

function normalizeChordName(value) {
  const match = String(value || '').trim().match(/^([A-Ga-g])([#b]?)(m7|maj7|m|7|sus2|sus4|dim)?$/i); if (!match) return '';
  const flats = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
  const root = `${match[1].toUpperCase()}${match[2] || ''}`; const suffixText = (match[3] || '').toLowerCase();
  const suffix = suffixText === 'maj7' ? 'maj7' : suffixText;
  return `${flats[root] || root}${suffix}`;
}

function chooseWebAudioFiles() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    input.accept = 'audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg';
    input.onchange = () => resolve([...input.files].map((file) => ({
      path: '', file, name: file.name.replace(/\.[^.]+$/, ''), sourceUrl: URL.createObjectURL(file),
    })));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

function detectAnchors(buffer, bpm, expectedEntry = 0) {
  const channel = buffer.getChannelData(0);
  const frameSeconds = 0.05;
  const frame = Math.max(256, Math.floor(buffer.sampleRate * frameSeconds));
  const envelope = [];
  for (let start = 0; start < channel.length; start += frame) {
    let sum = 0;
    const end = Math.min(channel.length, start + frame);
    for (let cursor = start; cursor < end; cursor += 8) sum += channel[cursor] * channel[cursor];
    envelope.push(Math.sqrt(sum / Math.max(1, Math.ceil((end - start) / 8))));
  }
  return {
    ...detectAnchorsFromEnvelope(envelope, frameSeconds, buffer.duration, bpm),
    ...detectBeatDriftFromEnvelope(envelope, frameSeconds, bpm, expectedEntry),
  };
}

function IconButton({ title, children, className = '', ...props }) {
  return <button className={`icon-button ${className}`} title={title} {...props}>{children}</button>;
}

function NumberField({ label, value, min = 0, max, step = 0.1, suffix, onChange }) {
  return <label className="field"><span>{label}</span><div className="number-wrap">
    <input type="number" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    {suffix && <small>{suffix}</small>}
  </div></label>;
}

function drawWaveform(canvas, track) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth; const height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.floor(width * ratio)); canvas.height = Math.max(1, Math.floor(height * ratio));
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height);
  const allPeaks = track.peaks || Array.from({ length: 700 }, (_, index) => Math.min(.94, Math.max(.08, .42 + Math.sin(index * .19) * .22 + Math.sin(index * .043) * .2 + ((index * 17) % 23) / 70)));
  const start = track.duration ? Math.floor(((track.trimStart || 0) / track.duration) * allPeaks.length) : 0;
  const end = track.duration ? Math.ceil(((track.duration - (track.trimEnd || 0)) / track.duration) * allPeaks.length) : allPeaks.length;
  const peaks = allPeaks.slice(start, Math.max(start + 1, end));
  const columns = Math.max(2, Math.floor(width / 2));
  const sampleSize = Math.max(1, peaks.length / columns);
  const step = width / Math.max(1, columns - 1);
  const amplitudes = Array.from({ length: columns }, (_item, index) => {
    const from = Math.floor(index * sampleSize);
    const to = Math.min(peaks.length, Math.ceil((index + 1) * sampleSize));
    let peak = 0;
    for (let cursor = from; cursor < to; cursor += 1) peak = Math.max(peak, peaks[cursor] || 0);
    return Math.max(.025, peak);
  });
  const center = height / 2;
  const scale = (height - 8) / 2;
  ctx.beginPath();
  ctx.moveTo(0, center);
  amplitudes.forEach((peak, index) => ctx.lineTo(index * step, center - peak * scale));
  for (let index = amplitudes.length - 1; index >= 0; index -= 1) ctx.lineTo(index * step, center + amplitudes[index] * scale);
  ctx.closePath();
  ctx.fillStyle = track.color;
  ctx.globalAlpha = .88;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,.2)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.34)';
  ctx.fillRect(0, center, width, 1);
}

function TimelineTrack({ track, index, zoom, selected, playing, onSelect, onPlay, onTrimStart, onTrim }) {
  const canvasRef = useRef(null);
  const trimDragRef = useRef(null);
  const [trimSide, setTrimSide] = useState(null);
  const width = Math.max(24, playableDuration(track) * zoom);
  const entry = Math.min(playableDuration(track), anchorIn(track)) * zoom;
  const exit = Math.min(playableDuration(track), anchorOut(track)) * zoom;
  useEffect(() => {
    const canvas = canvasRef.current; const redraw = () => drawWaveform(canvas, track); redraw();
    const observer = new ResizeObserver(redraw); observer.observe(canvas); return () => observer.disconnect();
  }, [track, zoom]);
  const startTrim = (event, side) => {
    if (event.button !== 0 || !track.duration) return;
    event.preventDefault(); event.stopPropagation(); onSelect(); onTrimStart();
    trimDragRef.current = { side, startX: event.clientX, trimStart: track.trimStart || 0, trimEnd: track.trimEnd || 0 };
    setTrimSide(side); event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveTrim = (event) => {
    const drag = trimDragRef.current; if (!drag) return;
    event.preventDefault(); event.stopPropagation();
    const delta = (event.clientX - drag.startX) / zoom;
    const maxStart = Math.max(0, track.duration - drag.trimEnd - .05);
    const maxEnd = Math.max(0, track.duration - drag.trimStart - .05);
    if (drag.side === 'start') onTrim({ trimStart: Math.min(maxStart, Math.max(0, drag.trimStart + delta)) });
    else onTrim({ trimEnd: Math.min(maxEnd, Math.max(0, drag.trimEnd - delta)) });
  };
  const endTrim = (event) => {
    if (!trimDragRef.current) return;
    event.preventDefault(); event.stopPropagation(); trimDragRef.current = null; setTrimSide(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className="timeline-track-row" style={{ top: 38 + index * 94 }}>
    <span className="lane-number">T{index + 1}</span>
    <div className={`timeline-clip anchor-clip ${selected ? 'selected' : ''} ${(track.exitConfidence ?? 1) < .65 ? 'anchor-error' : ''} ${(track.beatConfidence || 0) >= .2 && Math.abs(track.beatDriftMs || 0) >= 75 ? 'drift-warning' : ''}`} style={{ left: (track.offset || 0) * zoom, width, '--clip-color': track.color }}
      onClick={onSelect} onDoubleClick={(event) => { event.stopPropagation(); onPlay(); }}>
      <div className="clip-title"><span>{String(index + 1).padStart(2, '0')}</span><strong>{track.name}</strong>{(track.beatConfidence || 0) >= .2 && Math.abs(track.beatDriftMs || 0) >= 75 && <em>DRIFT {Math.abs(track.beatDriftMs)}ms</em>}<small>{formatTime(playableDuration(track))}</small></div>
      <canvas ref={canvasRef} />
      <div className="anchor-marker anchor-in" style={{ left: entry }}><b>IN</b></div>
      <div className="anchor-marker anchor-out" style={{ left: exit }}><b>OUT</b></div>
      <button className={`trim-handle trim-start ${trimSide === 'start' ? 'dragging' : ''}`} title={`ลากเพื่อตัดหัว · ${(track.trimStart || 0).toFixed(2)} วินาที`} aria-label="ตัดหัวเพลงบน waveform" onPointerDown={(event) => startTrim(event, 'start')} onPointerMove={moveTrim} onPointerUp={endTrim} onPointerCancel={endTrim}><i /></button>
      <button className={`trim-handle trim-end ${trimSide === 'end' ? 'dragging' : ''}`} title={`ลากเพื่อตัดท้าย · ${(track.trimEnd || 0).toFixed(2)} วินาที`} aria-label="ตัดท้ายเพลงบน waveform" onPointerDown={(event) => startTrim(event, 'end')} onPointerMove={moveTrim} onPointerUp={endTrim} onPointerCancel={endTrim}><i /></button>
      {playing && <div className="clip-playing"><AudioLines size={13} /> PLAYING</div>}
    </div>
  </div>;
}

function QueueItem({ track, index, count, selected, playing, onSelect, onPlay, onMove, onRemove }) {
  const music = track.musicAnalysis;
  return <div className={`queue-item ${selected ? 'selected' : ''}`} onClick={onSelect}>
    <button className="queue-play" title={playing ? 'หยุด' : 'เล่นจากเพลงนี้'} onClick={(event) => { event.stopPropagation(); onPlay(); }}>{playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}</button>
    <span className="queue-color" style={{ background: track.color }} /><div><strong>{track.name}</strong><small>{music?.bpm ? `${music.bpmConfidence < .35 ? '≈ ' : ''}${music.bpm.toFixed(2)} BPM · ${music.keyConfidence >= .3 ? (music.camelot || music.keyLabel) : 'KEY ?'}` : `${formatTime(track.offset || 0)} · ${formatTime(playableDuration(track))}`}</small></div>
    <div className="queue-move"><button disabled={index === 0} title="เลื่อนขึ้น" onClick={(event) => { event.stopPropagation(); onMove(-1); }}><ArrowUp size={12} /></button><button disabled={index === count - 1} title="เลื่อนลง" onClick={(event) => { event.stopPropagation(); onMove(1); }}><ArrowDown size={12} /></button></div>
    <button className="queue-remove" title="ลบ" onClick={(event) => { event.stopPropagation(); onRemove(); }}><X size={13} /></button>
  </div>;
}

function App() {
  const [tracks, setTracks] = useState(() => new URLSearchParams(location.search).has('demo') ? demoTracks : []);
  const [selectedId, setSelectedId] = useState(null); const [bpm, setBpm] = useState(136); const [introBars, setIntroBars] = useState(1);
  const [zoom, setZoom] = useState(2);
  const [playhead, setPlayhead] = useState(0); const [playing, setPlaying] = useState(false); const [currentIndex, setCurrentIndex] = useState(-1);
  const [analyzing, setAnalyzing] = useState(false); const [exporting, setExporting] = useState(false); const [progress, setProgress] = useState(0); const [renderInfo, setRenderInfo] = useState(null); const [renderElapsed, setRenderElapsed] = useState(0); const [message, setMessage] = useState(''); const [showShortcuts, setShowShortcuts] = useState(false); const [showExportSettings, setShowExportSettings] = useState(false);
  const [exportFormat, setExportFormat] = useState(() => { const stored = localStorage.getItem('r9club-export-format'); return exportFormats.some((item) => item.value === stored) ? stored : 'wav'; }); const [mp3Bitrate, setMp3Bitrate] = useState(() => { const stored = Number(localStorage.getItem('r9club-mp3-bitrate')); return mp3Bitrates.includes(stored) ? stored : 320; });
  const [auditionBars, setAuditionBars] = useState(8); const [loopRange, setLoopRange] = useState(null); const [qualityReport, setQualityReport] = useState(null);
  const [historyStatus, setHistoryStatus] = useState({ undo: 0, redo: 0 }); const [recoveryProject, setRecoveryProject] = useState(null); const [autosaveReady, setAutosaveReady] = useState(false); const [autosaveState, setAutosaveState] = useState('');
  const [showAudioPanel, setShowAudioPanel] = useState(false); const [audioDevices, setAudioDevices] = useState([]); const [audioDeviceId, setAudioDeviceId] = useState(() => localStorage.getItem('r9club-audio-device') || 'default'); const [latencyMode, setLatencyMode] = useState(() => localStorage.getItem('r9club-latency-mode') || 'playback');
  const [audioBackend, setAudioBackend] = useState(() => api && desktopPlatform === 'win32' ? localStorage.getItem('r9club-audio-backend') || 'shared' : 'shared'); const [audioCapabilities, setAudioCapabilities] = useState(null); const [probingAudio, setProbingAudio] = useState(false); const [asioDriver, setAsioDriver] = useState(() => localStorage.getItem('r9club-asio-driver') || '');
  const [audioStats, setAudioStats] = useState({ state: 'idle', sampleRate: 0, baseLatency: null, outputLatency: null, interruptions: 0, sinkSupported: false, deviceLabel: 'System Default' });
  const [musicAnalyzingId, setMusicAnalyzingId] = useState(null);
  const timelineRef = useRef(null); const panRef = useRef(null); const buffersRef = useRef(new Map()); const contextRef = useRef(null); const sourcesRef = useRef([]); const animationRef = useRef(null); const clockRef = useRef(null); const loopRangeRef = useRef(null);
  const tracksRef = useRef(tracks); const undoRef = useRef([]); const redoRef = useRef([]); const renderStartedRef = useRef(null); const webRenderTimerRef = useRef(null); const playingRef = useRef(false); const nativePlaybackRef = useRef(false);

  const selected = tracks.find((track) => track.id === selectedId) || tracks[0];
  const selectedMusic = selected?.musicAnalysis;
  const totalDuration = useMemo(() => tracks.length ? Math.max(...tracks.map((track) => (track.offset || 0) + playableDuration(track))) : 0, [tracks]);
  const masterSampleRate = useMemo(() => Math.max(44100, ...tracks.map((track) => track.sampleRate || 0)), [tracks]);
  const selectedExportFormat = exportFormats.find((item) => item.value === exportFormat) || exportFormats[0];
  const exportSampleRate = exportFormat === 'mp3' ? mp3SampleRateFor(masterSampleRate) : masterSampleRate;
  const estimatedRenderBytes = useMemo(() => estimateExportBytes(totalDuration, exportSampleRate, exportFormat, mp3Bitrate), [totalDuration, exportSampleRate, exportFormat, mp3Bitrate]);
  const rulerInterval = zoom >= 5 ? 15 : zoom >= 2 ? 30 : 60; const rulerMarks = [];
  for (let time = 0; time <= totalDuration; time += rulerInterval) rulerMarks.push(time);
  const transitionTimes = tracks.slice(1).map((track) => (track.offset || 0) + anchorIn(track));

  const setTracksSynced = useCallback((updater) => {
    setTracks((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      tracksRef.current = next; return next;
    });
  }, []);
  const resetHistory = useCallback(() => { undoRef.current = []; redoRef.current = []; setHistoryStatus({ undo: 0, redo: 0 }); }, []);
  const checkpointTracks = useCallback(() => {
    undoRef.current = [...undoRef.current.slice(-39), tracksRef.current.map((track) => ({ ...track }))];
    redoRef.current = []; setHistoryStatus({ undo: undoRef.current.length, redo: 0 });
  }, []);
  const commitTracks = useCallback((updater) => {
    const current = tracksRef.current; const next = typeof updater === 'function' ? updater(current) : updater;
    undoRef.current = [...undoRef.current.slice(-39), current.map((track) => ({ ...track }))]; redoRef.current = [];
    tracksRef.current = next; setTracks(next); setHistoryStatus({ undo: undoRef.current.length, redo: 0 });
  }, []);

  useEffect(() => { if (!selectedId && tracks.length) setSelectedId(tracks[0].id); }, [tracks, selectedId]);
  useEffect(() => { if (new URLSearchParams(location.search).has('audio')) setShowAudioPanel(true); }, []);
  useEffect(() => api?.onExportProgress?.(setProgress), []);
  useEffect(() => api?.onExportState?.((state) => setRenderInfo((current) => ({ ...current, ...state }))), []);
  useEffect(() => {
    if (!exporting) { setRenderElapsed(0); return undefined; }
    if (['complete', 'verification-failed', 'error'].includes(renderInfo?.phase)) return undefined;
    const update = () => setRenderElapsed(Math.max(0, (Date.now() - renderStartedRef.current) / 1000)); update();
    const timer = setInterval(update, 500); return () => clearInterval(timer);
  }, [exporting, renderInfo?.phase]);
  useEffect(() => () => { if (webRenderTimerRef.current) clearInterval(webRenderTimerRef.current); }, []);

  const refreshAudioDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) { setAudioDevices([]); return; }
    try {
      const listed = await navigator.mediaDevices.enumerateDevices();
      const outputs = listed.filter((device) => device.kind === 'audiooutput');
      const unique = outputs.filter((device, index) => outputs.findIndex((item) => item.deviceId === device.deviceId) === index);
      setAudioDevices(unique);
    } catch (_error) { setAudioDevices([]); }
  }, []);
  useEffect(() => {
    refreshAudioDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshAudioDevices);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshAudioDevices);
  }, [refreshAudioDevices]);
  const probeAudioCapabilities = useCallback(async () => {
    if (!api?.getAudioCapabilities) { setAudioCapabilities({ wasapi: { available: false, error: 'ใช้ได้ในโปรแกรม Windows' }, asio: { available: false, drivers: [], reason: 'ใช้ได้ในโปรแกรม Windows' } }); return; }
    setProbingAudio(true);
    try {
      const capabilities = await api.getAudioCapabilities(masterSampleRate, asioDriver);
      setAudioCapabilities(capabilities);
      if (capabilities.asio?.driver && capabilities.asio.driver !== asioDriver) { setAsioDriver(capabilities.asio.driver); localStorage.setItem('r9club-asio-driver', capabilities.asio.driver); }
    }
    catch (error) { setAudioCapabilities({ wasapi: { available: false, error: error.message }, asio: { available: false, drivers: [], reason: 'ตรวจสอบไม่สำเร็จ' } }); }
    finally { setProbingAudio(false); }
  }, [masterSampleRate, asioDriver]);
  useEffect(() => { if (showAudioPanel) probeAudioCapabilities(); }, [showAudioPanel, probeAudioCapabilities]);
  useEffect(() => api?.onAudioEngineState?.((state) => {
    if (state.event === 'started') setAudioStats((current) => ({ ...current, state: 'running', sampleRate: state.sampleRate, baseLatency: state.latencyMs / 1000, outputLatency: state.latencyMs / 1000, bufferFrames: state.bufferFrames }));
    else if (state.event === 'stats') setAudioStats((current) => ({ ...current, interruptions: state.underruns }));
    else if (state.event === 'error' && nativePlaybackRef.current) { nativePlaybackRef.current = false; playingRef.current = false; setPlaying(false); setMessage(state.message || 'Native audio engine หยุดทำงาน'); }
  }), []);

  const stopPlayback = useCallback((preserveLoop = false) => {
    sourcesRef.current.forEach((source) => { try { source.stop(); } catch (_error) { /* already stopped */ } });
    if (nativePlaybackRef.current) { nativePlaybackRef.current = false; api?.stopExclusivePlayback?.(); }
    sourcesRef.current = []; if (animationRef.current) cancelAnimationFrame(animationRef.current); animationRef.current = null; clockRef.current = null; playingRef.current = false; setPlaying(false);
    if (!preserveLoop) { loopRangeRef.current = null; setLoopRange(null); }
  }, []);
  useEffect(() => () => { stopPlayback(); contextRef.current?.close(); }, [stopPlayback]);

  const undoTracks = useCallback(() => {
    const previous = undoRef.current.pop(); if (!previous) return;
    stopPlayback(); redoRef.current.push(tracksRef.current.map((track) => ({ ...track })));
    tracksRef.current = previous; setTracks(previous); setHistoryStatus({ undo: undoRef.current.length, redo: redoRef.current.length });
  }, [stopPlayback]);
  const redoTracks = useCallback(() => {
    const next = redoRef.current.pop(); if (!next) return;
    stopPlayback(); undoRef.current.push(tracksRef.current.map((track) => ({ ...track })));
    tracksRef.current = next; setTracks(next); setHistoryStatus({ undo: undoRef.current.length, redo: redoRef.current.length });
  }, [stopPlayback]);

  const startPlayback = useCallback(async (from = 0, options = {}) => {
    const requestedLoop = options.loopRange || null;
    stopPlayback(Boolean(requestedLoop));
    loopRangeRef.current = requestedLoop; setLoopRange(requestedLoop);
    const ready = tracks.filter((track) => buffersRef.current.has(track.id));
    if (!ready.length) { stopPlayback(); setMessage('กำลังอ่านไฟล์เสียง กรุณารอสักครู่'); return; }
    const preferredSampleRate = Math.max(...ready.map((track) => buffersRef.current.get(track.id).sampleRate));
    const playbackEnd = requestedLoop?.end || totalDuration;
    const startAt = Math.max(0, Math.min(from, Math.max(0, playbackEnd - .01)));
    if (['wasapi-exclusive', 'asio'].includes(audioBackend) && api?.startExclusivePlayback) {
      try {
        const isAsio = audioBackend === 'asio';
        const result = isAsio
          ? await api.startAsioPlayback({ tracks, from: startAt, loopRange: requestedLoop, sampleRate: preferredSampleRate, driver: asioDriver })
          : await api.startExclusivePlayback({ tracks, from: startAt, loopRange: requestedLoop, sampleRate: preferredSampleRate });
        nativePlaybackRef.current = true;
        const now = performance.now() / 1000;
        clockRef.current = { contextTime: now, timelineTime: startAt }; setPlayhead(startAt); playingRef.current = true; setPlaying(true);
        setAudioStats((current) => ({ ...current, state: 'running', sampleRate: result.sampleRate, baseLatency: result.latencyMs / 1000, outputLatency: result.latencyMs / 1000, bufferFrames: result.bufferFrames, sinkSupported: true, deviceLabel: isAsio ? result.driver : 'Windows Default Output' }));
        const tickNative = () => {
          if (!clockRef.current || !nativePlaybackRef.current) return;
          const time = Math.min(playbackEnd, clockRef.current.timelineTime + Math.max(0, performance.now() / 1000 - clockRef.current.contextTime)); setPlayhead(time);
          const active = tracks.map((track, index) => ({ track, index })).filter(({ track }) => time >= (track.offset || 0) && time < (track.offset || 0) + playableDuration(track));
          setCurrentIndex(active.length ? active.at(-1).index : -1);
          if (time >= playbackEnd) { if (requestedLoop) startPlayback(requestedLoop.start, { loopRange: requestedLoop }); else stopPlayback(); }
          else animationRef.current = requestAnimationFrame(tickNative);
        };
        animationRef.current = requestAnimationFrame(tickNative);
      } catch (error) { stopPlayback(); setMessage(`เปิด ${audioBackend === 'asio' ? 'ASIO' : 'WASAPI Exclusive'} ไม่สำเร็จ: ${error.message}`); }
      return;
    }
    let context = contextRef.current;
    if (!context || context.state === 'closed' || context.sampleRate !== preferredSampleRate) {
      if (context && context.state !== 'closed') await context.close();
      try { context = new AudioContext({ latencyHint: latencyMode, sampleRate: preferredSampleRate }); }
      catch (_error) { context = new AudioContext({ latencyHint: latencyMode }); }
      if (typeof context.setSinkId === 'function' && audioDeviceId !== 'default') {
        try { await context.setSinkId(audioDeviceId); }
        catch (_error) { setMessage('ไม่สามารถเปิดอุปกรณ์เสียงที่เลือกได้ ระบบกลับไปใช้ Default Output'); setAudioDeviceId('default'); }
      }
      context.onstatechange = () => {
        const state = context.state;
        setAudioStats((current) => ({ ...current, state, interruptions: state === 'interrupted' && playingRef.current ? current.interruptions + 1 : current.interruptions }));
      };
      contextRef.current = context;
    }
    await context.resume();
    const chosenDevice = audioDevices.find((device) => device.deviceId === audioDeviceId);
    setAudioStats((current) => ({ ...current, state: context.state, sampleRate: context.sampleRate, baseLatency: context.baseLatency ?? null, outputLatency: context.outputLatency ?? null, sinkSupported: typeof context.setSinkId === 'function', deviceLabel: chosenDevice?.label || (audioDeviceId === 'default' ? 'System Default' : 'Selected Output') }));
    const now = context.currentTime + .05;
    tracks.forEach((track) => {
      const buffer = buffersRef.current.get(track.id); if (!buffer) return;
      const clipStart = track.offset || 0; const duration = playableDuration(track); const clipEnd = clipStart + duration;
      if (clipEnd <= startAt) return;
      const local = Math.max(0, startAt - clipStart); const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
      source.start(now + Math.max(0, clipStart - startAt), (track.trimStart || 0) + local, Math.max(.01, duration - local)); sourcesRef.current.push(source);
    });
    clockRef.current = { contextTime: now, timelineTime: startAt }; setPlayhead(startAt); playingRef.current = true; setPlaying(true);
    const tick = () => {
      if (!clockRef.current) return;
      const time = Math.min(playbackEnd, clockRef.current.timelineTime + Math.max(0, context.currentTime - clockRef.current.contextTime)); setPlayhead(time);
      const active = tracks.map((track, index) => ({ track, index })).filter(({ track }) => time >= (track.offset || 0) && time < (track.offset || 0) + playableDuration(track));
      setCurrentIndex(active.length ? active.at(-1).index : -1);
      if (time >= playbackEnd) {
        if (requestedLoop) startPlayback(requestedLoop.start, { loopRange: requestedLoop }); else stopPlayback();
      } else animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
  }, [tracks, totalDuration, stopPlayback, audioDeviceId, latencyMode, audioDevices, audioBackend, asioDriver]);

  const applyAudioSetting = useCallback(async (updates) => {
    stopPlayback();
    const context = contextRef.current; contextRef.current = null;
    if (context && context.state !== 'closed') await context.close();
    if (updates.deviceId !== undefined) { setAudioDeviceId(updates.deviceId); localStorage.setItem('r9club-audio-device', updates.deviceId); }
    if (updates.latencyMode !== undefined) { setLatencyMode(updates.latencyMode); localStorage.setItem('r9club-latency-mode', updates.latencyMode); }
    if (updates.backend !== undefined) { setAudioBackend(updates.backend); localStorage.setItem('r9club-audio-backend', updates.backend); }
    if (updates.asioDriver !== undefined) { setAsioDriver(updates.asioDriver); localStorage.setItem('r9club-asio-driver', updates.asioDriver); }
    setAudioStats((current) => ({ ...current, state: 'idle', interruptions: 0 }));
  }, [stopPlayback]);

  useEffect(() => {
    if (!playing || !timelineRef.current) return;
    const viewport = timelineRef.current; const x = playhead * zoom;
    if (x < viewport.scrollLeft + 70 || x > viewport.scrollLeft + viewport.clientWidth - 70) viewport.scrollTo({ left: Math.max(0, x - viewport.clientWidth * .35), behavior: 'smooth' });
  }, [playhead, playing, zoom]);

  const decodeTrack = async (track, analysisBpm = bpm, analysisIntroBars = introBars) => {
    try {
      const data = await fetch(track.sourceUrl).then((response) => response.arrayBuffer()); const context = new AudioContext(); const buffer = await context.decodeAudioData(data);
      if (buffer.numberOfChannels > 2) throw new Error('รองรับไฟล์ Mono และ Stereo โดยไม่ Downmix เท่านั้น');
      buffersRef.current.set(track.id, buffer);
      const channel = buffer.getChannelData(0); const slots = 1000; const block = Math.max(1, Math.floor(channel.length / slots));
      const peaks = Array.from({ length: slots }, (_, index) => { let peak = 0; const start = index * block; for (let cursor = start; cursor < Math.min(start + block, channel.length); cursor += 16) peak = Math.max(peak, Math.abs(channel[cursor])); return Math.min(1, peak * 1.65); });
      let signalPeak = 0; let clippedSamples = 0; let inspectedSamples = 0;
      for (let cursor = 0; cursor < channel.length; cursor += 8) { const level = Math.abs(channel[cursor]); signalPeak = Math.max(signalPeak, level); if (level >= .999) clippedSamples += 1; inspectedSamples += 1; }
      let musicAnalysis = null; let musicAnalysisError = '';
      try { musicAnalysis = preserveManualMusicAnalysis(await analyzeMusicBuffer(buffer), track.musicAnalysis); }
      catch (error) { musicAnalysisError = error.message || 'วิเคราะห์ BPM/KEY ไม่สำเร็จ'; }
      const detectedBpm = musicAnalysis?.bpmConfidence >= .45 ? musicAnalysis.bpm : analysisBpm;
      const expectedEntry = templateEntryAnchor(detectedBpm, analysisIntroBars, buffer.duration);
      const anchors = detectAnchors(buffer, detectedBpm, expectedEntry);
      anchors.entryAnchor = expectedEntry;
      anchors.entryConfidence = 1;
      await context.close();
      setTracksSynced((current) => alignTracks(current.map((item) => item.id === track.id ? { ...item, duration: buffer.duration, sampleRate: buffer.sampleRate, channelCount: buffer.numberOfChannels, peaks, signalPeak, clippedRatio: clippedSamples / Math.max(1, inspectedSamples), musicAnalysis, musicAnalysisError, ...anchors } : item)));
      return true;
    } catch (_error) { setMessage(`อ่าน waveform ของ ${track.name} ไม่สำเร็จ`); return false; }
  };

  const addTracks = async () => {
    if (analyzing) return;
    const chosen = api ? await api.chooseAudio() : await chooseWebAudioFiles(); if (!chosen.length) return; const startIndex = tracks.length;
    const next = chosen.map((track, index) => ({ ...track, id: `${Date.now()}-${index}`, duration: 0, trimStart: 0, trimEnd: 0, entryAnchor: 0, exitAnchor: 0, offset: 0, color: colors[(startIndex + index) % colors.length], peaks: null }));
    commitTracks((current) => [...current, ...next]); setAnalyzing(true); setMessage(`กำลังตรวจ BPM · KEY · CHORD · IN/OUT จำนวน ${chosen.length} เพลง`);
    const results = await Promise.all(next.map((track) => decodeTrack(track)));
    const completed = results.filter(Boolean).length; setAnalyzing(false);
    setMessage(completed === chosen.length ? `วิเคราะห์ Music DNA และจัด Anchor ครบ ${completed} เพลงแล้ว` : `วิเคราะห์สำเร็จ ${completed}/${chosen.length} เพลง กรุณาตรวจไฟล์ที่อ่านไม่สำเร็จ`);
  };

  const updateTrack = (id, updates) => commitTracks((current) => alignTracks(current.map((track) => track.id === id ? { ...track, ...updates } : track)));
  const previewTrack = (id, updates) => setTracksSynced((current) => alignTracks(current.map((track) => track.id === id ? { ...track, ...updates } : track)));
  const analyzeTrackMusic = async (track) => {
    const buffer = buffersRef.current.get(track.id); if (!buffer || musicAnalyzingId) return;
    setMusicAnalyzingId(track.id); setMessage(`กำลังวิเคราะห์ BPM · KEY · CHORD ของ ${track.name}`);
    try {
      const musicAnalysis = preserveManualMusicAnalysis(await analyzeMusicBuffer(buffer), track.musicAnalysis); const detectedBpm = musicAnalysis.bpmConfidence >= .45 ? musicAnalysis.bpm : bpm;
      const expectedEntry = templateEntryAnchor(detectedBpm, introBars, buffer.duration); const anchors = detectAnchors(buffer, detectedBpm, expectedEntry);
      setTracksSynced((current) => alignTracks(current.map((item) => item.id === track.id ? { ...item, musicAnalysis, musicAnalysisError: '', ...anchors, entryAnchor: expectedEntry, entryConfidence: 1 } : item)));
      setMessage(`วิเคราะห์แล้ว: ${musicAnalysis.bpm.toFixed(2)} BPM · ${musicAnalysis.keyConfidence >= .3 ? `${musicAnalysis.keyLabel} (${musicAnalysis.camelot})` : 'KEY ต้องยืนยัน'} · ${musicAnalysis.chords.length} ช่วงคอร์ด`);
    } catch (error) { setTracksSynced((current) => current.map((item) => item.id === track.id ? { ...item, musicAnalysisError: error.message } : item)); setMessage(`วิเคราะห์เพลงไม่สำเร็จ: ${error.message}`); }
    finally { setMusicAnalyzingId(null); }
  };
  const confirmDetectedBpm = (value) => {
    if (!selected || !selectedMusic) return; const detectedBpm = Math.min(240, Math.max(40, Number(value) || selectedMusic.bpm));
    updateTrack(selected.id, { musicAnalysis: { ...selectedMusic, bpm: detectedBpm, bpmConfidence: 1, bpmAmbiguous: false, bpmSource: 'manual' } });
  };
  const confirmDetectedKey = (value) => {
    if (!selected || !selectedMusic) return; const choice = keyChoices.find((item) => item.value === value); if (!choice) return;
    const [key, scale] = choice.value.split('|');
    updateTrack(selected.id, { musicAnalysis: { ...selectedMusic, key, scale, keyLabel: choice.label, camelot: choice.camelot, keyConfidence: 1, keySource: 'manual' } });
  };
  const editDetectedChord = (index) => {
    if (!selected || !selectedMusic?.chords?.[index]) return; const current = selectedMusic.chords[index];
    const entered = window.prompt('แก้คอร์ด (เช่น C, F#m, G7, Bbmaj7, Asus4)', current.label); if (entered === null) return;
    const label = normalizeChordName(entered);
    if (!label) { setMessage('รูปแบบคอร์ดไม่ถูกต้อง · รองรับ Major, Minor, 7, maj7, m7, sus2, sus4 และ dim'); return; }
    const chords = selectedMusic.chords.map((chord, chordIndex) => chordIndex === index ? { ...chord, label, confidence: 1, source: 'manual' } : chord);
    updateTrack(selected.id, { musicAnalysis: { ...selectedMusic, chords } }); setMessage(`ยืนยันคอร์ด ${current.label} → ${label} แล้ว`);
  };
  const analyzeAll = async () => {
    if (!tracks.length) return; setAnalyzing(true);
    try {
      checkpointTracks();
      setTracksSynced((current) => alignTracks(current.map((track) => {
        const buffer = buffersRef.current.get(track.id);
        if (!buffer) return track;
        const trackBpm = track.musicAnalysis?.bpmConfidence >= .45 ? track.musicAnalysis.bpm : bpm;
        const expectedEntry = templateEntryAnchor(trackBpm, introBars, buffer.duration);
        const anchors = detectAnchors(buffer, trackBpm, expectedEntry);
        return { ...track, ...anchors, entryAnchor: expectedEntry, entryConfidence: 1 };
      })));
      setMessage('ตรวจ OUT ใหม่โดยเก็บเสียงหัวและท้ายไฟล์ไว้ครบแล้ว');
    } catch (error) { setMessage(`วิเคราะห์ไม่สำเร็จ: ${error.message}`); } finally { setAnalyzing(false); }
  };

  const seekTimeline = (time) => { const safe = Math.max(0, Math.min(time, totalDuration)); setPlayhead(safe); const active = tracks.map((track, index) => ({ track, index })).filter(({ track }) => safe >= (track.offset || 0) && safe < (track.offset || 0) + playableDuration(track)); if (active.length) { setCurrentIndex(active.at(-1).index); setSelectedId(active.at(-1).track.id); } if (playing) startPlayback(safe); };
  const togglePlayback = () => playing ? stopPlayback() : startPlayback(playhead >= totalDuration ? 0 : playhead);
  const auditionTransition = () => {
    if (!transitionTimes.length) { setMessage('ต้องมีอย่างน้อย 2 เพลงเพื่อทดลองช่วงเชื่อม'); return; }
    const selectedIndex = Math.max(0, tracks.findIndex((track) => track.id === selected?.id));
    const linkIndex = Math.min(transitionTimes.length - 1, selectedIndex > 0 ? selectedIndex - 1 : Math.max(0, currentIndex));
    const center = transitionTimes[linkIndex]; const barSeconds = 4 * 60 / Math.max(1, bpm); const duration = auditionBars * barSeconds;
    const start = Math.max(0, center - duration / 2); const end = Math.min(totalDuration, start + duration);
    setSelectedId(tracks[linkIndex + 1].id); startPlayback(start, { loopRange: { start, end, linkIndex } });
  };
  const handlePointerDown = (event) => { if (event.button !== 0) return; const viewport = timelineRef.current; panRef.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, moved: false }; viewport.setPointerCapture(event.pointerId); viewport.classList.add('panning'); };
  const handlePointerMove = (event) => { if (!panRef.current) return; const dx = event.clientX - panRef.current.x; const dy = event.clientY - panRef.current.y; if (Math.abs(dx) > 4 || Math.abs(dy) > 4) panRef.current.moved = true; timelineRef.current.scrollLeft = panRef.current.left - dx; timelineRef.current.scrollTop = panRef.current.top - dy; };
  const handlePointerUp = (event) => { const viewport = timelineRef.current; if (panRef.current && !panRef.current.moved) { const rect = viewport.getBoundingClientRect(); seekTimeline((viewport.scrollLeft + event.clientX - rect.left) / zoom); } panRef.current = null; viewport.classList.remove('panning'); if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId); };
  const handleWheel = (event) => {
    const viewport = timelineRef.current;
    if (event.ctrlKey) {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect(); const cursorX = event.clientX - rect.left;
      const timelineTime = (viewport.scrollLeft + cursorX) / zoom;
      const nextZoom = Math.min(8, Math.max(.5, zoom + (event.deltaY < 0 ? .35 : -.35)));
      if (nextZoom === zoom) return;
      setZoom(nextZoom);
      requestAnimationFrame(() => { viewport.scrollLeft = Math.max(0, timelineTime * nextZoom - cursorX); });
    } else if (event.shiftKey) { event.preventDefault(); viewport.scrollLeft += event.deltaY; }
  };
  const moveTrack = (index, direction) => { stopPlayback(); commitTracks((current) => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return alignTracks(next); }); };
  const removeTrack = (id) => { stopPlayback(); commitTracks((current) => alignTracks(current.filter((track) => track.id !== id))); setPlayhead(0); };

  const getProjectPayload = () => ({ version: 6, savedAt: new Date().toISOString(), settings: { bpm, introBars, auditionBars }, tracks });
  const runQualityCheck = (pendingExport = false) => setQualityReport({ warnings: buildQualityWarnings(tracks, buffersRef.current), pendingExport });
  const openExportSettings = () => { if (tracks.length && !exporting) setShowExportSettings(true); };
  const exportMix = async (skipQuality = false) => {
    if (!tracks.length) return;
    setShowExportSettings(false);
    const unreadable = tracks.filter((track) => !track.duration || (api && !track.path));
    if (unreadable.length) { setMessage(`ยัง Export ไม่ได้: มีไฟล์เสียงที่อ่านไม่สำเร็จ ${unreadable.length} เพลง`); return; }
    if (!skipQuality) { const warnings = buildQualityWarnings(tracks, buffersRef.current); if (warnings.length) { setQualityReport({ warnings, pendingExport: true }); return; } }
    setExporting(true); setProgress(0); renderStartedRef.current = Date.now();
    const formatQuality = exportFormat === 'mp3' ? `${mp3Bitrate} kbps CBR · Lossy` : selectedExportFormat.quality;
    setRenderInfo({ phase: 'selecting', format: exportFormat, quality: formatQuality, lossless: selectedExportFormat.lossless, bitrateKbps: exportFormat === 'mp3' ? mp3Bitrate : null, sampleRate: exportSampleRate, duration: totalDuration, estimatedBytes: estimatedRenderBytes, filePath: '' });
    if (!api) {
      setRenderInfo((current) => ({ ...current, phase: 'preparing', filePath: 'WEB PREVIEW · ไม่มีการเขียนไฟล์จริง' }));
      let value = 0;
      webRenderTimerRef.current = setInterval(() => {
        value = Math.min(100, value + 2); setProgress(value);
        if (value >= 100) {
          clearInterval(webRenderTimerRef.current); webRenderTimerRef.current = null;
          setRenderInfo((current) => ({ ...current, phase: 'verifying' }));
          const codec = exportFormat === 'mp3' ? 'mp3' : exportFormat === 'flac' ? 'flac' : 'pcm_f32le';
          setTimeout(() => setRenderInfo((current) => ({ ...current, phase: 'complete', verification: { passed: true, codec, bitrateKbps: exportFormat === 'mp3' ? mp3Bitrate : 0, sampleRate: exportSampleRate, channels: 2, duration: totalDuration, sampleCount: Math.round(totalDuration * exportSampleRate), peakDb: -0.84, fileBytes: estimatedRenderBytes, checks: { codec: true, sampleRate: true, channels: true, duration: true } } })), 850);
        }
      }, 80);
      return;
    }
    try {
      const result = await api.exportMix({ tracks, options: { format: exportFormat, bitrateKbps: mp3Bitrate } });
      if (result.canceled) { setExporting(false); return; }
      setRenderInfo((current) => ({ ...current, phase: result.verification?.passed ? 'complete' : 'verification-failed', filePath: result.filePath, verification: result.verification }));
      setMessage(result.verification?.passed ? `Render และตรวจไฟล์ ${exportFormat.toUpperCase()} ผ่านแล้ว: ${result.filePath}` : `Render เสร็จ แต่ผลตรวจไฟล์มีข้อผิดพลาด: ${result.filePath}`);
    } catch (error) { setRenderInfo((current) => ({ ...current, phase: 'error', error: error.message })); setMessage(`Render ไม่สำเร็จ: ${error.message}`); }
  };
  const cancelRender = () => {
    if (['complete', 'verification-failed', 'error'].includes(renderInfo?.phase)) { setExporting(false); return; }
    if (api) api.cancelExport();
    else if (webRenderTimerRef.current) { clearInterval(webRenderTimerRef.current); webRenderTimerRef.current = null; setExporting(false); setProgress(0); setMessage('ยกเลิก Render Preview แล้ว'); }
  };
  useEffect(() => {
    if (api || !new URLSearchParams(location.search).has('render') || !tracks.length) return undefined;
    const timer = setTimeout(() => exportMix(), 350); return () => clearTimeout(timer);
  }, []);
  const saveProject = async () => { if (!api) { setMessage('การบันทึกโปรเจกต์ใช้ในโปรแกรม Windows'); return; } const result = await api.saveProject(getProjectPayload()); if (!result.canceled) { await api.clearAutosave?.(); setAutosaveState('saved'); setMessage(`บันทึกโปรเจกต์แล้ว: ${result.filePath}`); } };
  const loadProjectData = async (project) => {
    stopPlayback(); buffersRef.current.clear();
    const projectBpm = project.settings?.bpm || 136; const projectIntroBars = project.settings?.introBars ?? 1;
    const loaded = alignTracks((project.tracks || []).map((track, index) => ({ ...track, trimStart: track.trimStart || 0, trimEnd: track.trimEnd || 0, color: track.color || colors[index % colors.length], sourceUrl: track.sourceUrl || (track.path ? `beatblend-audio://file?path=${encodeURIComponent(track.path)}` : '') })));
    setTracksSynced(loaded); resetHistory(); setSelectedId(loaded[0]?.id || null); setBpm(projectBpm); setIntroBars(projectIntroBars); setAuditionBars(project.settings?.auditionBars || 8); setPlayhead(0); setAnalyzing(Boolean(loaded.length));
    const results = await Promise.all(loaded.map((track) => decodeTrack(track, projectBpm, projectIntroBars))); setAnalyzing(false);
    return results.filter(Boolean).length;
  };
  const openProject = async () => { if (!api) { setMessage('การเปิดโปรเจกต์ใช้ในโปรแกรม Windows'); return; } const project = await api.openProject(); if (!project) return; const loaded = await loadProjectData(project); setMessage(`เปิดโปรเจกต์และอ่านเสียงสำเร็จ ${loaded} เพลง`); };
  const isActive = (track) => playing && playhead >= (track.offset || 0) && playhead < (track.offset || 0) + playableDuration(track);

  useEffect(() => {
    if (!api?.loadAutosave) { setAutosaveReady(true); return undefined; }
    let active = true;
    api.loadAutosave().then((project) => { if (!active) return; if (project?.tracks?.length) setRecoveryProject(project); else setAutosaveReady(true); }).catch(() => setAutosaveReady(true));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!api?.autosaveProject || !autosaveReady || recoveryProject || analyzing) return undefined;
    setAutosaveState('saving');
    const timer = setTimeout(() => { api.autosaveProject(getProjectPayload()).then(() => setAutosaveState('saved')).catch(() => setAutosaveState('error')); }, 900);
    return () => clearTimeout(timer);
  }, [auditionBars, autosaveReady, bpm, introBars, recoveryProject, tracks, analyzing]);
  const restoreAutosave = async () => {
    const project = recoveryProject; setRecoveryProject(null);
    const loaded = await loadProjectData(project); setAutosaveReady(true); setMessage(`กู้คืน Autosave สำเร็จ ${loaded} เพลง`);
  };
  const discardAutosave = async () => { await api?.clearAutosave?.(); setRecoveryProject(null); setAutosaveReady(true); setAutosaveState(''); };

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const editable = target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
      const key = event.key.toLowerCase();
      if (recoveryProject) return;
      if ((showShortcuts || qualityReport || showAudioPanel || showExportSettings) && event.key === 'Escape') { event.preventDefault(); setShowShortcuts(false); setQualityReport(null); setShowAudioPanel(false); setShowExportSettings(false); return; }
      if (showShortcuts || qualityReport || showAudioPanel || showExportSettings) return;
      if (event.ctrlKey && event.shiftKey && key === 'z') { event.preventDefault(); redoTracks(); return; }
      if (event.ctrlKey && key === 'z') { event.preventDefault(); undoTracks(); return; }
      if (event.ctrlKey && key === 'y') { event.preventDefault(); redoTracks(); return; }
      if (event.ctrlKey && event.shiftKey && key === 'o') { event.preventDefault(); addTracks(); return; }
      if (event.ctrlKey && key === 'o') { event.preventDefault(); openProject(); return; }
      if (event.ctrlKey && key === 's') { event.preventDefault(); saveProject(); return; }
      if (event.ctrlKey && key === 'e') { event.preventDefault(); openExportSettings(); return; }
      if (editable) return;
      const barSeconds = 4 * 60 / Math.max(1, bpm);
      if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
      else if (event.key === 'Escape') { event.preventDefault(); if (showShortcuts) setShowShortcuts(false); else stopPlayback(); }
      else if (event.key === 'Home') { event.preventDefault(); stopPlayback(); seekTimeline(0); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); seekTimeline(playhead - barSeconds * (event.shiftKey ? 4 : 1)); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); seekTimeline(playhead + barSeconds * (event.shiftKey ? 4 : 1)); }
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom((value) => Math.min(8, value + .5)); }
      else if (event.key === '-' || event.key === '_') { event.preventDefault(); setZoom((value) => Math.max(.5, value - .5)); }
      else if (key === 'l') { event.preventDefault(); auditionTransition(); }
      else if (event.key === 'Delete' && selected) { event.preventDefault(); removeTrack(selected.id); }
      else if (event.key === '?') { event.preventDefault(); setShowShortcuts(true); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [analyzing, auditionBars, bpm, historyStatus, playhead, playing, qualityReport, recoveryProject, selected, showShortcuts, showAudioPanel, showExportSettings, tracks, zoom]);

  const renderPhase = renderInfo?.phase === 'selecting' ? 'กำลังเลือกไฟล์ปลายทาง' : renderInfo?.phase === 'verifying' ? 'กำลังตรวจไฟล์ Master ที่สร้างเสร็จ' : renderInfo?.phase === 'complete' ? 'ตรวจสอบ Lossless Master ผ่านแล้ว' : renderInfo?.phase === 'verification-failed' ? 'ไฟล์ถูกสร้างแล้ว แต่ผลตรวจไม่ผ่าน' : renderInfo?.phase === 'error' ? 'Render ไม่สำเร็จ' : progress >= 99 ? 'กำลังปิดไฟล์ Master' : progress > 0 ? 'กำลัง Render และเข้ารหัสแบบ Lossless' : 'กำลังเตรียม Source Audio';
  const renderEta = progress > 1 && progress < 100 ? renderElapsed * (100 - progress) / progress : 0;
  const renderComplete = renderInfo?.phase === 'complete';
  const renderFailed = ['verification-failed', 'error'].includes(renderInfo?.phase);
  const audioLatencyMs = ((audioStats.outputLatency ?? audioStats.baseLatency) || 0) * 1000;
  const audioBufferFrames = audioStats.bufferFrames || Math.round((audioStats.baseLatency || 0) * (audioStats.sampleRate || masterSampleRate));

  return <div className="app-shell">
    <div className="titlebar"><div className="brand"><span className="brand-mark"><img src={r9Logo} alt="" /></span><span className="brand-copy"><strong>R9CLUB</strong><small>AUTOMIX</small></span></div><span className="project-name"><i /> LIVE ARRANGEMENT {!api && <b>WEB PREVIEW</b>}{api && autosaveState && <em className={`autosave-${autosaveState}`}>{autosaveState === 'saving' ? 'SAVING' : autosaveState === 'error' ? 'SAVE ERROR' : 'AUTOSAVED'}</em>}</span></div>
    <header className="toolbar"><div className="toolbar-group"><button className="tool-button" title="เปิดโปรเจกต์ (Ctrl+O)" onClick={openProject}><FolderOpen size={16} /> เปิด</button><button className="tool-button" title="บันทึกโปรเจกต์ (Ctrl+S)" onClick={saveProject} disabled={!tracks.length}><Save size={16} /> บันทึก</button><IconButton title="ย้อนกลับ (Ctrl+Z)" onClick={undoTracks} disabled={!historyStatus.undo}><Undo2 size={16} /></IconButton><IconButton title="ทำซ้ำ (Ctrl+Y)" onClick={redoTracks} disabled={!historyStatus.redo}><Redo2 size={16} /></IconButton><IconButton title="คำสั่งลัด (?)" onClick={() => setShowShortcuts(true)}><Keyboard size={17} /></IconButton></div>
      <div className="transport-controls"><IconButton title="เพลงก่อนหน้า" onClick={() => startPlayback(tracks[Math.max(0, currentIndex - 1)]?.offset || 0)} disabled={!tracks.length}><SkipBack size={16} fill="currentColor" /></IconButton><button className="main-play" title={playing ? 'หยุดชั่วคราว' : 'เล่นทั้งหมด'} onClick={togglePlayback} disabled={!tracks.length}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><IconButton title="เพลงถัดไป" onClick={() => startPlayback(tracks[Math.min(tracks.length - 1, Math.max(0, currentIndex + 1))]?.offset || 0)} disabled={!tracks.length}><SkipForward size={16} fill="currentColor" /></IconButton><span className="transport-time">{formatTime(playhead, true)} <i>/</i> {formatTime(totalDuration)}</span><div className="audition-mode">{[8, 16].map((bars) => <button key={bars} className={auditionBars === bars ? 'active' : ''} onClick={() => setAuditionBars(bars)}>{bars}B</button>)}</div><IconButton className={`loop-button ${loopRange ? 'active' : ''}`} title="ทดลองช่วงเชื่อมแบบวน (L)" onClick={auditionTransition} disabled={tracks.length < 2}><Repeat2 size={16} /></IconButton></div>
      <div className="toolbar-output"><span><b>{bpm}</b> BPM</span><span><b>{tracks.length}</b> TRACKS</span><IconButton className={`audio-button ${audioBackend !== 'shared' ? 'active' : ''}`} title="Audio Engine และอุปกรณ์เสียง" onClick={() => setShowAudioPanel(true)}><Headphones size={17} /></IconButton><IconButton className="quality-button" title="ตรวจ Click, Clipping และ Beat Drift" onClick={() => runQualityCheck(false)} disabled={!tracks.length}><ShieldCheck size={17} /></IconButton><button className="export-button" title="Export Mix (Ctrl+E)" onClick={openExportSettings} disabled={!tracks.length || exporting}><Download size={17} /> EXPORT</button></div>
    </header>
    <main className="workspace gapless-workspace">
      <aside className="settings-panel queue-panel"><div className="panel-heading"><ListMusic size={17} /><h2>คิวเพลง</h2><span>{tracks.length}</span></div><div className="queue-list">{tracks.map((track, index) => <QueueItem key={track.id} track={track} index={index} count={tracks.length} selected={selected?.id === track.id} playing={isActive(track)} onSelect={() => setSelectedId(track.id)} onPlay={() => isActive(track) ? stopPlayback() : startPlayback(track.offset || 0)} onMove={(direction) => moveTrack(index, direction)} onRemove={() => removeTrack(track.id)} />)}</div>
        <button className="queue-add" onClick={addTracks} disabled={analyzing}><Plus size={15} /> {analyzing ? 'กำลังวิเคราะห์ Music DNA...' : 'เพิ่มเพลง'}</button><section className="setting-section compact-settings"><div className="section-label"><Gauge size={15} /><span>Anchor Align</span></div><div className="field-grid"><NumberField label="Mix BPM สำรอง" value={bpm} min={40} max={240} step={1} onChange={setBpm} /><NumberField label="หัวก่อน IN" value={introBars} min={0} max={16} step={1} suffix="ห้อง" onChange={setIntroBars} /></div><div className="hard-cut-card"><Link2 size={16} /><span><b>Auto Anchor พร้อมใช้งาน</b><small>ใช้ BPM รายเพลงจัด IN → OUT อัตโนมัติ</small></span><Check size={15} /></div><button className="secondary-wide" onClick={analyzeAll} disabled={!tracks.length || analyzing}>{analyzing ? <RotateCcw className="spin" size={16} /> : <Activity size={16} />}{analyzing ? 'กำลังตรวจสอบ...' : 'วิเคราะห์ Anchor ใหม่'}</button></section>
      </aside>
      <section className="timeline-panel gapless-timeline"><div className="timeline-header"><div><h1>Arrangement</h1><p>{tracks.length ? `${tracks.length} เพลง · Auto Anchor Aligned` : 'ยังไม่มีเพลงใน Arrangement'}</p></div><div className="timeline-tools"><IconButton title="Zoom Out" onClick={() => setZoom((value) => Math.max(.5, value - .5))}><ZoomOut size={16} /></IconButton><input aria-label="Timeline zoom" title="Ctrl + Mouse Wheel เพื่อ Zoom ตรงตำแหน่งเมาส์" type="range" min="0.5" max="8" step="0.25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><IconButton title="Zoom In" onClick={() => setZoom((value) => Math.min(8, value + .5))}><ZoomIn size={16} /></IconButton><span>{zoom.toFixed(2)} px/s</span><button className="add-button" onClick={addTracks} disabled={analyzing}><Plus size={17} /> เพิ่มเพลง</button></div></div>
        {tracks.length ? <div ref={timelineRef} className="timeline-viewport" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onWheel={handleWheel}><div className="timeline-content anchor-content" style={{ width: Math.max(1, totalDuration * zoom), minHeight: Math.max(360, 52 + tracks.length * 94), '--beat-size': `${Math.max(4, (60 / bpm) * zoom)}px` }}><div className="timeline-ruler">{rulerMarks.map((time) => <span key={time} style={{ left: time * zoom }}>{formatTime(time)}</span>)}</div>{tracks.map((track, index) => <TimelineTrack key={track.id} track={track} index={index} zoom={zoom} selected={selected?.id === track.id} playing={isActive(track)} onSelect={() => setSelectedId(track.id)} onPlay={() => startPlayback(track.offset || 0)} onTrimStart={checkpointTracks} onTrim={(updates) => previewTrack(track.id, updates)} />)}{transitionTimes.map((time, index) => <div key={`${time}-${index}`} className="transition-guide" style={{ left: time * zoom }}><b>LINK {index + 1}</b></div>)}{loopRange && <div className="audition-range" style={{ left: loopRange.start * zoom, width: Math.max(2, (loopRange.end - loopRange.start) * zoom) }}><b>LOOP {auditionBars} BARS</b></div>}<div className="playhead" style={{ left: playhead * zoom }}><i /></div></div></div> : <div className="empty-state"><div className="empty-icon"><FileAudio size={34} /></div><h2>เลือกเพลงที่เตรียม Transition ไว้</h2><p>ระบบจะหา OUT และ IN แล้ววางซ้อนให้อัตโนมัติ</p><button className="add-button" onClick={addTracks}><Plus size={17} /> เลือกหลายเพลง</button></div>}
        <div className="timeline-status"><span>{loopRange ? <><Repeat2 size={13} /> Transition Loop · LINK {loopRange.linkIndex + 1}</> : <><Link2 size={13} /> Anchor aligned overlap</>}</span><span>{tracks.length} tracks</span><span>{formatTime(totalDuration)}</span></div>
      </section>
      <aside className="inspector-panel">
        <div className="panel-heading"><Scissors size={17} /><h2>ปรับ Anchor</h2></div>
        {selected ? <>
          <div className="selected-track"><span className="album-tile" style={{ background: selected.color }}><Music2 size={24} /></span><div><strong>{selected.name}</strong><span>{selected.sampleRate ? `${(selected.sampleRate / 1000).toFixed(1)} kHz · ${selected.channelCount === 1 ? 'Mono' : 'Stereo'}` : `เริ่มที่ ${formatTime(selected.offset || 0, true)}`} · {selectedMusic?.bpm?.toFixed(2) || bpm} BPM</span></div></div>
          <section className="inspector-section">
            <h3>จุดเชื่อมที่เตรียมไว้</h3><p className="anchor-help">IN = จุดรับเพลงนี้ · OUT = จุดส่งต่อไปเพลงถัดไป</p>
            <NumberField label="IN · จุดรับเพลงนี้" value={selected.entryAnchor || 0} max={selected.duration} suffix="วินาที" onChange={(value) => updateTrack(selected.id, { entryAnchor: Math.min(selected.duration, Math.max(0, value)), entryConfidence: 1 })} />
            <NumberField label="OUT · จุดส่งต่อเพลงถัดไป" value={selected.exitAnchor || selected.duration} max={selected.duration} suffix="วินาที" onChange={(value) => updateTrack(selected.id, { exitAnchor: Math.min(selected.duration, Math.max(0, value)), exitConfidence: 1 })} />
            <div className="anchor-summary"><span>ตำแหน่งบน Mix</span><b>{formatTime(selected.offset || 0, true)}</b><i /><span>ช่วงที่ซ้อน</span><b>{selected === tracks[0] ? '-' : `${Math.max(0, anchorIn(selected)).toFixed(1)}s`}</b></div>
          </section>
          <section className="inspector-section music-dna-section">
            <h3>Music DNA · BPM / Key / Chord</h3>
            {selectedMusic ? <>
              <div className="music-dna-meters">
                <span><small>BPM</small><b>{selectedMusic.bpmConfidence < .35 ? '≈ ' : ''}{selectedMusic.bpm.toFixed(2)}</b><em className={selectedMusic.bpmConfidence >= .65 ? 'verified' : 'review'}>{selectedMusic.bpmSource === 'manual' ? 'MANUAL' : `${Math.round(selectedMusic.bpmConfidence * 100)}%${selectedMusic.bpmConfidence < .35 ? ' · VERIFY' : ''}`}</em></span>
                <span><small>KEY</small><b>{selectedMusic.keyConfidence >= .3 ? selectedMusic.keyLabel : 'ยังไม่ยืนยัน'}</b><em className={selectedMusic.keyConfidence >= .65 ? 'verified' : 'review'}>{selectedMusic.keyConfidence >= .3 ? `${selectedMusic.camelot} · ` : ''}{Math.round(selectedMusic.keyConfidence * 100)}%</em></span>
              </div>
              <div className="music-dna-fields">
                <NumberField label="ยืนยัน BPM" value={selectedMusic.bpm} min={40} max={240} step={.01} onChange={confirmDetectedBpm} />
                <label className="field"><span>ยืนยัน Key</span><div className="number-wrap"><select value={`${selectedMusic.key}|${selectedMusic.scale}`} onChange={(event) => confirmDetectedKey(event.target.value)}>{keyChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label} · {choice.camelot}</option>)}</select></div></label>
              </div>
              <div className="music-analysis-detail"><span>TUNING <b>{selectedMusic.tuningFrequency} Hz</b> ({selectedMusic.tuningCents > 0 ? '+' : ''}{selectedMusic.tuningCents} cents)</span>{selectedMusic.bpmAmbiguous && <span className="review">ตรวจพบ Half/Double Tempo · กรุณาฟังยืนยัน</span>}</div>
              {selectedMusic.bpmCandidates?.length > 1 && <div className="candidate-row"><small>BPM CANDIDATES</small>{selectedMusic.bpmCandidates.slice(0, 4).map((candidate) => <button key={candidate.bpm} onClick={() => confirmDetectedBpm(candidate.bpm)}>{candidate.bpm}</button>)}</div>}
              <div className="chord-timeline"><small>CHORD TIMELINE · {selectedMusic.chords?.length || 0} ช่วง · คลิกเพื่อแก้และยืนยัน</small><div>{selectedMusic.chords?.length ? selectedMusic.chords.map((chord, index) => <button className={chord.source === 'manual' ? 'manual' : ''} key={`${chord.start}-${index}`} title={`${formatTime(chord.start, true)}–${formatTime(chord.end, true)} · ${Math.round(chord.confidence * 100)}%`} onClick={() => editDetectedChord(index)}>{chord.label}</button>) : <em>ยังไม่พบคอร์ดที่มั่นใจพอ</em>}</div></div>
              {selectedMusic.keyChanges?.length > 0 && <div className="key-change-note">พบการเปลี่ยน Key {selectedMusic.keyChanges.length} ช่วง · ไม่บังคับใช้ Global Key</div>}
            </> : <div className="music-dna-pending"><Activity className={musicAnalyzingId === selected.id ? 'spin' : ''} size={18} /><span><b>{selected.musicAnalysisError ? 'วิเคราะห์ไม่สำเร็จ' : 'รอวิเคราะห์ Music DNA'}</b><small>{selected.musicAnalysisError || 'ระบบจะตรวจ BPM, Key, Tuning และ Chord'}</small></span></div>}
            <button className="secondary-wide" disabled={Boolean(musicAnalyzingId)} onClick={() => analyzeTrackMusic(selected)}>{musicAnalyzingId === selected.id ? <RotateCcw className="spin" size={15} /> : <RefreshCw size={15} />}{musicAnalyzingId === selected.id ? 'กำลังวิเคราะห์...' : 'วิเคราะห์ BPM / KEY / CHORD ใหม่'}</button>
          </section>
          <section className="inspector-section quality-summary"><h3>Quality Signal</h3><div><span>Beat Drift</span><b className={(selected.beatConfidence || 0) >= .2 && Math.abs(selected.beatDriftMs || 0) >= 75 ? 'warn' : ''}>{(selected.beatConfidence || 0) < .2 ? 'ไม่พบปัญหา' : `${selected.beatDriftMs > 0 ? '+' : ''}${selected.beatDriftMs || 0} ms`}</b></div><div><span>Source Peak</span><b>{selected.signalPeak ? `${(20 * Math.log10(selected.signalPeak)).toFixed(1)} dBFS` : '-'}</b></div></section>
          <section className="inspector-section"><h3>Lossless Master</h3><div className="master-format"><span>WAV</span><b>32-BIT FLOAT</b></div><div className="lossless-lock"><ShieldCheck size={17} /><span><b>QUALITY LOCK</b><small>{(masterSampleRate / 1000).toFixed(1)} kHz · ไม่มี MP3 / Loudness / Fade</small></span></div></section>
          <button className="danger-text" onClick={() => removeTrack(selected.id)}><Trash2 size={15} /> ลบเพลงนี้</button>
        </> : <div className="inspector-empty"><Music2 size={22} /><span>เลือกเพลงเพื่อปรับ Anchor</span></div>}
      </aside>
    </main>
    {showExportSettings && <div className="modal-backdrop export-settings-backdrop" onMouseDown={() => setShowExportSettings(false)}><section className="export-settings-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <header className="export-settings-heading"><span><Download size={20} /></span><div><h2>EXPORT FORMAT</h2><p>เลือกไฟล์ Master หรือไฟล์สำหรับฟัง</p></div><IconButton title="ปิด" onClick={() => setShowExportSettings(false)}><X size={16} /></IconButton></header>
      <div className="export-settings-body">
        <div className="export-format-grid">{exportFormats.map((item) => <button key={item.value} className={exportFormat === item.value ? 'active' : ''} onClick={() => { setExportFormat(item.value); localStorage.setItem('r9club-export-format', item.value); }}><span><b>{item.label}</b><em>{item.lossless ? 'LOSSLESS' : 'LOSSY'}</em></span><strong>{item.quality}</strong><small>{item.detail}</small></button>)}</div>
        {exportFormat === 'mp3' && <div className="bitrate-setting"><span>MP3 BITRATE</span><div>{mp3Bitrates.map((bitrate) => <button key={bitrate} className={mp3Bitrate === bitrate ? 'active' : ''} onClick={() => { setMp3Bitrate(bitrate); localStorage.setItem('r9club-mp3-bitrate', String(bitrate)); }}>{bitrate}<small>kbps</small></button>)}</div></div>}
        <div className={`export-quality-notice ${selectedExportFormat.lossless ? 'lossless' : 'lossy'}`}>{selectedExportFormat.lossless ? <ShieldCheck size={19} /> : <TriangleAlert size={19} />}<span><b>{selectedExportFormat.lossless ? 'QUALITY LOCK · ไม่ใช้ Lossy Codec' : `MP3 ${mp3Bitrate} kbps · มีการลดข้อมูลเสียง`}</b><small>{selectedExportFormat.lossless ? `${selectedExportFormat.quality} · คง sample rate สูงสุด ${masterSampleRate / 1000} kHz` : 'MP3 เป็นไฟล์ Lossy ทุก bitrate — เลือก 320 kbps เพื่อคุณภาพสูงสุดของ MP3'}</small></span></div>
        <div className="export-estimate"><span><small>FORMAT</small><b>{exportFormat.toUpperCase()}</b></span><span><small>SAMPLE RATE</small><b>{(exportSampleRate / 1000).toFixed(1)} kHz</b></span><span><small>ESTIMATED SIZE</small><b>{formatBytes(estimatedRenderBytes)}</b></span></div>
      </div>
      <div className="dialog-actions"><button className="secondary-action" onClick={() => setShowExportSettings(false)}>ยกเลิก</button><button className="primary-action" onClick={() => exportMix()}><Download size={14} /> เลือกตำแหน่งบันทึก</button></div>
    </section></div>}
    {recoveryProject && <div className="modal-backdrop recovery-backdrop"><div className="recovery-dialog"><div className="dialog-symbol"><History size={23} /></div><div><h2>พบงานบันทึกอัตโนมัติ</h2><p>{recoveryProject.tracks?.length || 0} เพลง · {recoveryProject.savedAt ? new Date(recoveryProject.savedAt).toLocaleString('th-TH') : 'จากการใช้งานครั้งก่อน'}</p></div><div className="dialog-actions"><button className="secondary-action" onClick={discardAutosave}>ไม่ใช้ไฟล์นี้</button><button className="primary-action" onClick={restoreAutosave}><History size={15} /> กู้คืนงาน</button></div></div></div>}
    {qualityReport && <div className="modal-backdrop quality-backdrop" onMouseDown={() => setQualityReport(null)}><div className="quality-dialog" onMouseDown={(event) => event.stopPropagation()}><div className="quality-heading"><span className={qualityReport.warnings.length ? 'warning' : 'passed'}>{qualityReport.warnings.length ? <TriangleAlert size={21} /> : <ShieldCheck size={21} />}</span><div><h2>{qualityReport.warnings.length ? `พบ ${qualityReport.warnings.length} จุดที่ควรตรวจ` : 'QUALITY CHECK PASSED'}</h2><p>Anchor · Click · Clipping · Beat Drift</p></div><IconButton title="ปิด" onClick={() => setQualityReport(null)}><X size={16} /></IconButton></div>{qualityReport.warnings.length ? <div className="quality-list">{qualityReport.warnings.map((warning, index) => <button key={`${warning.type}-${warning.trackId}-${index}`} onClick={() => { setSelectedId(warning.trackId); setQualityReport(null); }}><TriangleAlert size={15} /><span><b>{warning.title}</b><small>{warning.detail}</small></span></button>)}</div> : <div className="quality-passed"><ShieldCheck size={31} /><b>ไม่พบจุดเสี่ยงในไฟล์และช่วงซ้อน</b><span>พร้อม Export ตาม Anchor ปัจจุบัน</span></div>}<div className="dialog-actions"><button className="secondary-action" onClick={() => setQualityReport(null)}>ปิด</button>{qualityReport.pendingExport && <button className="primary-action" onClick={() => { setQualityReport(null); exportMix(true); }}>Export ต่อ</button>}</div></div></div>}
    {showShortcuts && <div className="modal-backdrop shortcut-backdrop" onMouseDown={() => setShowShortcuts(false)}><div className="shortcut-dialog" onMouseDown={(event) => event.stopPropagation()}><div className="shortcut-heading"><span><Keyboard size={19} /></span><div><h2>COMMAND KEYS</h2><p>R9CLUB AUTOMIX</p></div><IconButton title="ปิด" onClick={() => setShowShortcuts(false)}><X size={16} /></IconButton></div><div className="shortcut-grid">{shortcuts.map(([command, keys]) => <div className="shortcut-row" key={command}><span>{command}</span><kbd>{keys}</kbd></div>)}</div></div></div>}
    {showAudioPanel && <div className="modal-backdrop audio-backdrop" onMouseDown={() => setShowAudioPanel(false)}><section className="audio-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <header className="audio-heading"><span><Headphones size={20} /></span><div><h2>AUDIO ENGINE</h2><p>Playback device, exclusive access and latency</p></div><IconButton title="ปิด" onClick={() => setShowAudioPanel(false)}><X size={16} /></IconButton></header>
      <div className="audio-dialog-body">
        <div className={`engine-modes ${desktopPlatform !== 'win32' ? 'single' : ''}`}>
          <button className={audioBackend === 'shared' ? 'active' : ''} onClick={() => applyAudioSetting({ backend: 'shared' })}><b>{desktopPlatform === 'darwin' ? 'MACOS SHARED' : 'WINDOWS SHARED'}</b><small>พร้อมใช้งาน</small></button>
          {desktopPlatform === 'win32' && <button className={audioBackend === 'wasapi-exclusive' ? 'active' : ''} disabled={!audioCapabilities?.wasapi?.available} title={audioCapabilities?.wasapi?.error || ''} onClick={() => applyAudioSetting({ backend: 'wasapi-exclusive' })}><b>WASAPI EXCLUSIVE</b><small>{probingAudio ? 'กำลังตรวจสอบ...' : audioCapabilities?.wasapi?.available ? 'พร้อมใช้งาน' : 'Driver ไม่อนุญาต'}</small></button>}
          {desktopPlatform === 'win32' && <button className={audioBackend === 'asio' ? 'active' : ''} disabled={!audioCapabilities?.asio?.drivers?.length} title={audioCapabilities?.asio?.error || ''} onClick={() => applyAudioSetting({ backend: 'asio' })}><b>ASIO</b><small>{probingAudio ? 'กำลังตรวจสอบ...' : audioCapabilities?.asio?.available ? 'พร้อมใช้งาน' : audioCapabilities?.asio?.drivers?.length ? 'เลือก Driver / Rate' : 'ไม่พบ driver'}</small></button>}
        </div>
        <div className="audio-config-grid">
          <label className="audio-device-field"><span>{audioBackend === 'asio' ? 'ASIO DRIVER' : 'OUTPUT DEVICE'}</span>{audioBackend === 'asio' ? <select value={asioDriver} onChange={(event) => applyAudioSetting({ asioDriver: event.target.value })}>{(audioCapabilities?.asio?.drivers || []).map((driver) => <option key={driver} value={driver}>{driver}</option>)}</select> : <select value={audioDeviceId} disabled={audioBackend !== 'shared'} onChange={(event) => applyAudioSetting({ deviceId: event.target.value })}>{audioDevices.length ? audioDevices.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || (device.deviceId === 'default' ? 'System Default' : `Audio Output ${index + 1}`)}</option>) : <option value="default">System Default</option>}</select>}</label>
          <div className="latency-control"><span>LATENCY PROFILE</span><div>{[['playback', 'STABLE'], ['interactive', 'LOW LATENCY']].map(([value, label]) => <button key={value} className={latencyMode === value ? 'active' : ''} disabled={audioBackend !== 'shared'} onClick={() => applyAudioSetting({ latencyMode: value })}>{label}</button>)}</div></div>
        </div>
        <div className="engine-diagnostics">
          <div><small>BACKEND</small><b>{audioBackend === 'asio' ? 'NAUDIO / ASIO' : audioBackend === 'wasapi-exclusive' ? 'WASAPI EXCLUSIVE' : desktopPlatform === 'darwin' ? 'CHROMIUM / CORE AUDIO' : 'CHROMIUM / WASAPI SHARED'}</b><span>{audioStats.state.toUpperCase()}</span></div>
          <div><small>SAMPLE RATE</small><b>{((audioStats.sampleRate || masterSampleRate) / 1000).toFixed(1)} kHz</b><span>Project maximum</span></div>
          <div><small>BUFFER</small><b>{audioBufferFrames || '-'} {audioBufferFrames ? 'frames' : ''}</b><span>{audioBackend === 'shared' ? 'Browser estimate' : 'Native driver latency'}</span></div>
          <div><small>OUTPUT LATENCY</small><b>{audioLatencyMs ? `${audioLatencyMs.toFixed(1)} ms` : '-'}</b><span>Reported by engine</span></div>
          <div><small>INTERRUPTIONS</small><b className={audioStats.interruptions ? 'warn' : ''}>{audioStats.interruptions}</b><span>{audioBackend === 'wasapi-exclusive' ? 'Native underruns' : audioBackend === 'asio' ? 'Driver stream stops' : 'Stream interruptions'}</span></div>
          <div><small>QUALITY PATH</small><b>32-BIT</b><span>No EQ / limiter / fade</span></div>
        </div>
        {desktopPlatform === 'win32' && audioCapabilities?.wasapi && !audioCapabilities.wasapi.available && <div className="engine-notice"><TriangleAlert size={16} /><span><b>Exclusive ยังเปิดไม่ได้บนอุปกรณ์ Default</b><small>{audioCapabilities.wasapi.error} เปิด “Allow applications to take exclusive control” ใน Windows Sound Settings แล้วกดตรวจใหม่</small></span></div>}
        {audioCapabilities?.asio?.drivers?.length > 0 && !audioCapabilities.asio.available && <div className="engine-notice neutral"><AudioLines size={16} /><span><b>{asioDriver || 'ASIO'} เปิดที่ {(masterSampleRate / 1000).toFixed(1)} kHz ไม่สำเร็จ</b><small>{audioCapabilities.asio.error} เลือก sample rate เดียวกันใน ASIO Control Panel แล้วกดตรวจใหม่</small></span></div>}
      </div>
      <footer><span>{audioStats.deviceLabel}</span><button onClick={probeAudioCapabilities} disabled={probingAudio}><RefreshCw className={probingAudio ? 'spin' : ''} size={14} /> ตรวจอุปกรณ์ใหม่</button></footer>
    </section></div>}
    {message && <div className="toast"><Check size={16} /><span>{message}</span><IconButton title="ปิด" onClick={() => setMessage('')}><X size={15} /></IconButton></div>}
    {exporting && <div className="modal-backdrop render-backdrop"><section className={`render-page ${renderComplete ? 'render-complete' : ''} ${renderFailed ? 'render-failed' : ''}`}>
      <header><div className="render-brand"><span>{renderComplete ? <ShieldCheck size={21} /> : renderFailed ? <TriangleAlert size={21} /> : <Download size={21} />}</span><div><h2>{renderInfo?.lossless === false ? 'RENDER MP3 LISTENING COPY' : 'RENDER LOSSLESS MASTER'}</h2><p>R9CLUB AUTOMIX</p></div></div><div className="render-live"><i /> {renderComplete ? 'VERIFIED' : renderFailed ? 'NEEDS ATTENTION' : renderInfo?.phase === 'verifying' ? 'VERIFYING' : 'PROCESSING'}</div></header>
      <div className="render-body"><div className="render-primary"><div className="render-status"><span>{renderPhase}</span><b>{progress}%</b></div><div className="render-progress"><i style={{ width: `${progress}%` }} /></div><div className="render-stages"><span className="active"><Check size={12} /> PREPARE</span><span className={progress > 0 ? 'active' : ''}><AudioLines size={12} /> MIX</span><span className={progress > 80 ? 'active' : ''}><Download size={12} /> ENCODE</span><span className={progress >= 99 ? 'active' : ''}><Check size={12} /> FINALIZE</span><span className={['verifying', 'complete', 'verification-failed'].includes(renderInfo?.phase) ? 'active' : ''}><ShieldCheck size={12} /> VERIFY</span></div></div>
        <div className="render-metrics"><div><small>FORMAT</small><b>{(renderInfo?.format || exportFormat).toUpperCase()}</b><span>{renderInfo?.quality || selectedExportFormat.quality}</span></div><div><small>SAMPLE RATE</small><b>{((renderInfo?.sampleRate || exportSampleRate) / 1000).toFixed(1)} kHz</b><span>{renderInfo?.lossless === false ? 'MP3 compatible output rate' : 'Highest source rate'}</span></div><div><small>ARRANGEMENT</small><b>{tracks.length} TRACKS</b><span>{formatTime(totalDuration)} · No Fade</span></div><div><small>FILE SIZE</small><b>{formatBytes(renderInfo?.verification?.fileBytes || renderInfo?.estimatedBytes || estimatedRenderBytes)}</b><span>{renderInfo?.verification?.fileBytes ? 'Actual file size' : 'Estimated before render'}</span></div><div><small>TIME</small><b>{formatTime(renderElapsed, true)}</b><span>{renderEta ? `เหลือประมาณ ${formatTime(renderEta)}` : renderComplete || renderFailed ? 'เสร็จสิ้น' : 'กำลังคำนวณ'}</span></div></div>
        <div className="render-output"><span>OUTPUT FILE</span><b title={renderInfo?.filePath || ''}>{renderInfo?.filePath || 'รอเลือกตำแหน่งบันทึก...'}</b></div>
        {renderInfo?.verification ? <div className={`verification-report ${renderInfo.verification.passed ? 'passed' : 'failed'}`}><div className="verification-title">{renderInfo.verification.passed ? <ShieldCheck size={18} /> : <TriangleAlert size={18} />}<span><b>{renderInfo.verification.passed ? 'POST-RENDER VERIFICATION PASSED' : 'POST-RENDER VERIFICATION FAILED'}</b><small>เปิดอ่านไฟล์ที่สร้างเสร็จและตรวจสเปกจริงแล้ว</small></span></div><div className="verification-values"><span><small>CODEC</small><b>{renderInfo.verification.codec || '-'}</b></span><span><small>DURATION</small><b>{formatTime(renderInfo.verification.duration, true)}</b></span><span><small>PEAK</small><b>{Number.isFinite(renderInfo.verification.peakDb) ? `${renderInfo.verification.peakDb.toFixed(2)} dBFS` : '-∞ dBFS'}</b></span><span><small>{renderInfo?.format === 'mp3' ? 'BITRATE' : 'SAMPLES'}</small><b>{renderInfo?.format === 'mp3' ? `${renderInfo.verification.bitrateKbps || renderInfo.bitrateKbps || '-'} kbps` : (renderInfo.verification.sampleCount || 0).toLocaleString()}</b></span></div></div> : renderInfo?.phase === 'error' ? <div className="render-error"><TriangleAlert size={18} /><span><b>RENDER ENGINE ERROR</b><small>{String(renderInfo.error || 'FFmpeg stopped before the master was completed').slice(-360)}</small></span></div> : <div className={`render-integrity ${renderInfo?.lossless === false ? 'lossy' : ''}`}>{renderInfo?.lossless === false ? <TriangleAlert size={17} /> : <ShieldCheck size={17} />}<span><b>{renderInfo?.lossless === false ? 'MP3 HIGH-QUALITY ENCODE' : 'QUALITY LOCK ENABLED'}</b><small>{renderInfo?.lossless === false ? `${renderInfo?.bitrateKbps || mp3Bitrate} kbps CBR · MP3 เป็นไฟล์ Lossy` : 'Double-precision mix · High-quality resampling · No lossy codec'}</small></span></div>}
      </div>
      <footer><span>FFmpeg Audio Engine · {renderInfo?.freeBytes ? `${formatBytes(renderInfo.freeBytes)} free before render` : api ? 'Checking destination capacity' : 'Web Preview simulation'}</span><div>{renderInfo?.filePath && (renderComplete || renderFailed) && api?.revealFile && <button className="reveal-render" onClick={() => api.revealFile(renderInfo.filePath)}><FolderOpen size={14} /> แสดงไฟล์</button>}<button onClick={cancelRender}>{renderComplete || renderFailed ? <Check size={14} /> : <X size={14} />} {renderComplete || renderFailed ? 'ปิดรายงาน' : 'ยกเลิก Render'}</button></div></footer>
    </section></div>}
  </div>;
}

export default App;
