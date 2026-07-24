const { spawnSync } = require('node:child_process');

const releaseScript = process.platform === 'win32'
  ? 'dist:win'
  : process.platform === 'darwin'
    ? 'dist:mac'
    : null;

if (!releaseScript) {
  console.error('R9CLUB AUTOMIX release builds support Windows and macOS only.');
  process.exit(1);
}

console.log(`Building ${process.platform === 'win32' ? 'Windows NSIS' : 'macOS DMG/ZIP'} release...`);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCommand, ['run', releaseScript], { stdio: 'inherit', windowsHide: true });
process.exit(result.status ?? 1);
