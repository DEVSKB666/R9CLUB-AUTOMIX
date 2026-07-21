const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

app.commandLine.appendSwitch('disable-gpu');

async function capture(url, fileName, width, height, delay) {
  const window = new BrowserWindow({ width, height, show: false, webPreferences: { offscreen: true } });
  await window.loadURL(url);
  await new Promise((resolve) => setTimeout(resolve, delay));
  const image = await window.webContents.capturePage();
  await fs.writeFile(path.join(__dirname, '..', fileName), image.toPNG());
  window.destroy();
}

app.whenReady().then(async () => {
  const mode = process.argv[2] || 'audio';
  const compact = process.argv[3] === 'compact';
  const width = compact ? 1080 : 1440;
  const height = compact ? 680 : 900;
  const query = mode === 'render' ? 'demo=1&render=1' : 'demo=1&audio=1';
  const fileName = `ui-${mode}-${width}.png`;
  await capture(`http://127.0.0.1:5173/?${query}`, fileName, width, height, mode === 'render' ? 6200 : 1800);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
