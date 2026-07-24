const fs = require('node:fs');
const path = require('node:path');
const png2icons = require('png2icons');

const projectRoot = path.join(__dirname, '..');
const inputPath = path.join(projectRoot, 'src', 'assets', 'r9club-logo.png');
const outputPath = path.join(projectRoot, 'build', 'icon.icns');
const input = fs.readFileSync(inputPath);
const output = png2icons.createICNS(input, png2icons.BICUBIC, 0);

if (!output) throw new Error('Unable to create macOS ICNS icon');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output);
console.log(outputPath);
