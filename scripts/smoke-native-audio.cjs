const { spawn } = require('node:child_process');
const path = require('node:path');
const ffmpegPath = require('ffmpeg-static');

const playerPath = path.join(__dirname, '..', 'electron', 'native', 'asio-player.exe');
const ffmpeg = spawn(ffmpegPath, [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'sine=frequency=440:duration=0.4:sample_rate=48000', '-af', 'volume=0.015',
  '-f', 'f32le', '-ac', '2', '-ar', '48000', 'pipe:1',
], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const player = spawn(playerPath, ['--driver', 'Focusrite USB ASIO', '--rate', '48000'], {
  windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'],
});

let diagnostics = '';
ffmpeg.stdout.pipe(player.stdin);
ffmpeg.stderr.on('data', (chunk) => { diagnostics += chunk.toString(); });
player.stderr.on('data', (chunk) => { diagnostics += chunk.toString(); });

const timeout = setTimeout(() => {
  ffmpeg.kill(); player.kill();
  console.error('ASIO smoke test timed out');
  process.exitCode = 1;
}, 10000);

player.once('close', (code) => {
  clearTimeout(timeout);
  if (code !== 0 || !diagnostics.includes('"event":"started"')) {
    console.error(diagnostics || `ASIO player exited with ${code}`);
    process.exitCode = 1;
    return;
  }
  console.log('Native ASIO float32 playback smoke test passed');
});
