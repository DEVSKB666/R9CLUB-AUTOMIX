const { app, BrowserWindow, dialog, ipcMain, protocol, net, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ffmpegPath = require('ffmpeg-static');
const { buildFilter, estimateExportBytes, getExportProfile, parseRenderVerification, parseSilenceOutput } = require('./audio-engine.cjs');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'beatblend-audio',
    privileges: { stream: true, supportFetchAPI: true, corsEnabled: true, standard: true, secure: true },
  },
]);

let mainWindow;
let exportProcess = null;
let exportCanceled = false;
let exclusiveFfmpeg = null;
let exclusivePlayer = null;

function getFfmpegPath() {
  return ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

function getWasapiPlayerPath() {
  return path.join(__dirname, 'native', 'wasapi-player.exe').replace('app.asar', 'app.asar.unpacked');
}

function getAsioPlayerPath() {
  return path.join(__dirname, 'native', 'asio-player.exe').replace('app.asar', 'app.asar.unpacked');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#090b0c',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#090b0c', symbolColor: '#d7dadc', height: 50 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  else mainWindow.loadURL('http://127.0.0.1:5173');
}

app.whenReady().then(() => {
  protocol.handle('beatblend-audio', (request) => {
    const url = new URL(request.url);
    const filePath = url.searchParams.get('path');
    if (!filePath) return new Response('Missing path', { status: 400 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('before-quit', stopExclusivePlayback);

ipcMain.handle('audio:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'เลือกเพลง',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'] }],
  });
  if (result.canceled) return [];
  return result.filePaths.map((filePath) => ({
    path: filePath,
    name: path.basename(filePath, path.extname(filePath)),
    sourceUrl: `beatblend-audio://file?path=${encodeURIComponent(filePath)}`,
  }));
});

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(getFfmpegPath(), args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(stderr || `FFmpeg exited with code ${code}`));
    });
  });
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => resolve({ code: -1, stdout, stderr: error.message }));
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function lastJsonLine(text, predicate = () => true) {
  for (const line of text.trim().split(/\r?\n/).reverse()) {
    try { const value = JSON.parse(line); if (predicate(value)) return value; } catch (_error) { /* diagnostic line */ }
  }
  return null;
}

async function getAudioCapabilities(sampleRate = 48000, requestedAsioDriver = '') {
  if (process.platform !== 'win32') {
    return {
      wasapi: { available: false, sampleRate, error: 'WASAPI Exclusive ใช้ได้เฉพาะ Windows' },
      asio: { available: false, drivers: [], driver: '', sampleRate, error: 'ASIO ใช้ได้เฉพาะ Windows' },
    };
  }
  const probe = await runCommand(getWasapiPlayerPath(), ['--probe', '--rate', String(sampleRate)]);
  let wasapi = { available: false, sampleRate, error: 'WASAPI Exclusive is unavailable' };
  if (probe.code === 0) {
    wasapi = lastJsonLine(probe.stdout) || wasapi;
  } else {
    wasapi.error = lastJsonLine(probe.stderr, (value) => value.event === 'error')?.message || probe.stderr.trim().split(/\r?\n/).at(-1) || wasapi.error;
  }
  const asioListResult = await runCommand(getAsioPlayerPath(), ['--list']);
  const asioList = lastJsonLine(asioListResult.stdout) || { available: false, drivers: [] };
  const asioDriver = asioList.drivers.includes(requestedAsioDriver)
    ? requestedAsioDriver
    : asioList.drivers.find((driver) => /Focusrite USB/i.test(driver)) || asioList.drivers[0] || '';
  let asio = { available: false, drivers: asioList.drivers, driver: asioDriver, sampleRate, error: asioList.drivers.length ? 'ASIO driver does not support this sample rate' : 'No ASIO driver is installed' };
  if (asioDriver) {
    const asioProbe = await runCommand(getAsioPlayerPath(), ['--probe', '--driver', asioDriver, '--rate', String(sampleRate)]);
    if (asioProbe.code === 0) asio = { ...asio, ...(lastJsonLine(asioProbe.stdout) || {}) };
    else asio.error = lastJsonLine(asioProbe.stderr, (value) => value.event === 'error')?.message || asio.error;
  }
  return { wasapi, asio };
}

function stopExclusivePlayback() {
  if (exclusiveFfmpeg) { exclusiveFfmpeg.kill(); exclusiveFfmpeg = null; }
  if (exclusivePlayer) { exclusivePlayer.kill(); exclusivePlayer = null; }
}

function startNativePlayback({ tracks, from, loopRange, sampleRate, playerPath, playerArgs, muxer, backend }) {
  const inputs = tracks.flatMap((track) => ['-i', track.path]);
  const engine = buildFilter(tracks, { sampleRate });
  const previewEnd = loopRange?.end || engine.duration;
  const previewDuration = Math.max(0.01, previewEnd - from);
  const previewOutput = '[native-preview]';
  const filter = `${engine.filter};${engine.output}atrim=start=${Math.max(0, from)}:duration=${previewDuration},asetpts=PTS-STARTPTS${previewOutput}`;
  const ffmpegArgs = ['-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', previewOutput, '-f', muxer, '-ac', '2', '-ar', String(sampleRate), 'pipe:1'];
  const ffmpeg = spawn(getFfmpegPath(), ffmpegArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const player = spawn(playerPath, playerArgs, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  exclusiveFfmpeg = ffmpeg; exclusivePlayer = player;
  ffmpeg.stdout.pipe(player.stdin);
  let playerBuffer = '';
  return new Promise((resolve, reject) => {
    let settled = false;
    const startupTimer = setTimeout(() => {
      if (settled) return;
      settled = true; stopExclusivePlayback(); reject(new Error(`${backend} driver did not start within 8 seconds`));
    }, 8000);
    const settleError = (error) => {
      if (!settled) { settled = true; clearTimeout(startupTimer); reject(error); }
    };
    player.stderr.on('data', (chunk) => {
      playerBuffer += chunk.toString();
      const lines = playerBuffer.split(/\r?\n/); playerBuffer = lines.pop();
      lines.forEach((line) => {
        try {
          const state = JSON.parse(line);
          if (state.event !== 'device') mainWindow.webContents.send('audio:engine-state', state);
          if (state.event === 'started' && !settled) { settled = true; clearTimeout(startupTimer); resolve(state); }
          else if (state.event === 'error') settleError(new Error(state.message));
        } catch (_error) { /* native diagnostic line */ }
      });
    });
    ffmpeg.once('error', (error) => {
      if (exclusiveFfmpeg !== ffmpeg) return;
      mainWindow.webContents.send('audio:engine-state', { event: 'error', message: error.message }); settleError(error);
    });
    player.once('error', (error) => {
      if (exclusivePlayer !== player) return;
      mainWindow.webContents.send('audio:engine-state', { event: 'error', message: error.message }); settleError(error);
    });
    player.once('close', (code) => {
      if (exclusivePlayer !== player) return;
      const message = code === 0 ? '' : `${backend} stream stopped unexpectedly`;
      mainWindow.webContents.send('audio:engine-state', { event: code === 0 ? 'ended' : 'error', message });
      if (!settled) settleError(new Error(message || `${backend} stream ended before playback`));
      stopExclusivePlayback();
    });
  });
}

ipcMain.handle('audio:analyze-silence', async (_event, { path: filePath, threshold = -42, duration = 0.35 }) => {
  const output = await runFfmpeg([
    '-hide_banner', '-i', filePath, '-af', `silencedetect=noise=${threshold}dB:d=${duration}`, '-f', 'null', '-',
  ]);
  return parseSilenceOutput(output);
});

ipcMain.handle('audio:capabilities', async (_event, { sampleRate, asioDriver } = {}) => getAudioCapabilities(sampleRate, asioDriver));

ipcMain.handle('audio:exclusive-stop', () => {
  stopExclusivePlayback();
  return true;
});

ipcMain.handle('audio:exclusive-start', async (_event, { tracks, from = 0, loopRange = null, sampleRate }) => {
  if (!tracks?.length || tracks.some((track) => !track.path)) throw new Error('WASAPI Exclusive ต้องใช้ไฟล์เสียงในโปรแกรม Windows');
  stopExclusivePlayback();
  const capabilities = await getAudioCapabilities(sampleRate);
  if (!capabilities.wasapi.available) throw new Error(capabilities.wasapi.error);
  const sampleFormat = capabilities.wasapi.sampleFormat;
  const muxer = sampleFormat === 'f32le' ? 'f32le' : 's32le';
  const started = await startNativePlayback({ tracks, from, loopRange, sampleRate, playerPath: getWasapiPlayerPath(), playerArgs: ['--rate', String(sampleRate), '--format', sampleFormat], muxer, backend: 'WASAPI' });
  return { ...capabilities.wasapi, ...started };
});

ipcMain.handle('audio:asio-start', async (_event, { tracks, from = 0, loopRange = null, sampleRate, driver }) => {
  if (!tracks?.length || tracks.some((track) => !track.path)) throw new Error('ASIO ต้องใช้ไฟล์เสียงในโปรแกรม Windows');
  stopExclusivePlayback();
  const capabilities = await getAudioCapabilities(sampleRate, driver);
  if (!capabilities.asio.available) throw new Error(capabilities.asio.error);
  const started = await startNativePlayback({ tracks, from, loopRange, sampleRate, playerPath: getAsioPlayerPath(), playerArgs: ['--driver', capabilities.asio.driver, '--rate', String(sampleRate)], muxer: 'f32le', backend: 'ASIO' });
  return { ...capabilities.asio, ...started };
});

ipcMain.handle('audio:export', async (_event, { tracks, options = {} }) => {
  if (!tracks?.length) throw new Error('ไม่มีเพลงสำหรับ Export');
  if (tracks.some((track) => !track.path || !track.duration)) throw new Error('มีไฟล์เสียงที่ยังอ่านไม่สำเร็จ กรุณาตรวจรายการเพลงก่อน Export');
  const sourceSampleRate = Math.max(44100, ...tracks.map((track) => track.sampleRate || 0));
  const profile = getExportProfile(options, sourceSampleRate);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Mix',
    defaultPath: `R9CLUB ${profile.lossless ? 'Lossless Master' : 'Listening Copy'}.${profile.extension}`,
    filters: [{ name: profile.dialogName, extensions: [profile.extension] }],
  });
  if (result.canceled) return { canceled: true };
  const selectedExtension = path.extname(result.filePath).toLowerCase();
  const outputPath = selectedExtension === `.${profile.extension}`
    ? result.filePath
    : path.join(path.dirname(result.filePath), `${path.basename(result.filePath, selectedExtension)}.${profile.extension}`);

  const inputs = tracks.flatMap((track) => ['-i', track.path]);
  const { filter, output, duration, sampleRate } = buildFilter(tracks, { sampleRate: profile.sampleRate });
  const estimatedBytes = estimateExportBytes(duration, profile);
  const destinationStats = await fs.statfs(path.dirname(outputPath));
  const freeBytes = Number(destinationStats.bavail) * Number(destinationStats.bsize);
  const requiredBytes = Math.ceil(estimatedBytes * 1.05) + 32 * 1024 * 1024;
  if (freeBytes < requiredBytes) {
    throw new Error(`พื้นที่ว่างไม่พอสำหรับไฟล์ ${profile.format.toUpperCase()}: ต้องใช้ประมาณ ${Math.ceil(requiredBytes / 1048576)} MB แต่เหลือ ${Math.floor(freeBytes / 1048576)} MB`);
  }
  const args = ['-y', ...inputs, '-filter_complex', filter, '-map', output, ...profile.codecArgs, '-ar', String(sampleRate), outputPath];
  const exportState = { filePath: outputPath, format: profile.format, quality: profile.quality, lossless: profile.lossless, bitrateKbps: profile.bitrateKbps || null, sampleRate, duration, estimatedBytes, freeBytes };
  mainWindow.webContents.send('audio:export-state', { phase: 'preparing', ...exportState });

  return new Promise((resolve, reject) => {
    exportCanceled = false;
    exportProcess = spawn(getFfmpegPath(), args, { windowsHide: true });
    let stderr = '';
    exportProcess.stderr.on('data', (chunk) => {
      const outputText = chunk.toString();
      stderr += outputText;
      const match = outputText.match(/time=(\d+):(\d+):([\d.]+)/);
      if (match) {
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        mainWindow.webContents.send('audio:export-progress', Math.min(99, Math.round((seconds / duration) * 100)));
      }
    });
    exportProcess.once('error', reject);
    exportProcess.once('close', async (code) => {
      exportProcess = null;
      if (code === 0) {
        mainWindow.webContents.send('audio:export-progress', 100);
        mainWindow.webContents.send('audio:export-state', { phase: 'verifying', ...exportState });
        try {
          const verificationOutput = await runFfmpeg([
            '-hide_banner', '-i', outputPath, '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-',
          ]);
          const fileStats = await fs.stat(outputPath);
          const verification = {
            ...parseRenderVerification(verificationOutput, { codecs: profile.expectedCodecs, bitrateKbps: profile.bitrateKbps, sampleRate, channels: 2, duration }),
            fileBytes: fileStats.size,
          };
          mainWindow.webContents.send('audio:export-state', { phase: verification.passed ? 'complete' : 'verification-failed', ...exportState, verification });
          resolve({ canceled: false, filePath: outputPath, verification });
        } catch (error) {
          const verification = { passed: false, error: error.message };
          mainWindow.webContents.send('audio:export-state', { phase: 'verification-failed', ...exportState, verification });
          resolve({ canceled: false, filePath: outputPath, verification });
        }
      } else if (exportCanceled || code === null) { mainWindow.webContents.send('audio:export-state', { phase: 'canceled' }); resolve({ canceled: true }); }
      else { const message = stderr.slice(-1200); mainWindow.webContents.send('audio:export-state', { phase: 'error', error: message }); reject(new Error(message)); }
    });
  });
});

ipcMain.handle('audio:cancel-export', () => {
  if (exportProcess) {
    exportCanceled = true;
    exportProcess.kill();
  }
});

ipcMain.handle('file:reveal', (_event, filePath) => {
  if (filePath) shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('project:save', async (_event, project) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'บันทึกโปรเจกต์',
    defaultPath: 'R9CLUB Mix.beatblend',
    filters: [{ name: 'R9CLUB AUTOMIX Project', extensions: ['beatblend'] }],
  });
  if (result.canceled) return { canceled: true };
  await fs.writeFile(result.filePath, JSON.stringify(project, null, 2), 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'เปิดโปรเจกต์',
    properties: ['openFile'],
    filters: [{ name: 'R9CLUB AUTOMIX Project', extensions: ['beatblend'] }],
  });
  if (result.canceled) return null;
  return JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'));
});

function getAutosavePath() {
  return path.join(app.getPath('userData'), 'autosave.beatblend');
}

ipcMain.handle('project:autosave', async (_event, project) => {
  await fs.writeFile(getAutosavePath(), JSON.stringify(project), 'utf8');
  return true;
});

ipcMain.handle('project:load-autosave', async () => {
  try {
    return JSON.parse(await fs.readFile(getAutosavePath(), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
});

ipcMain.handle('project:clear-autosave', async () => {
  try { await fs.unlink(getAutosavePath()); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return true;
});
