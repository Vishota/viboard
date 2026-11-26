// Карточка 150: значок viboard (веб-favicon) — везде у exe. Запуск: node desktop/icon/build.mjs
// 1) Браузер (Edge, встроен в Windows; подойдёт Chrome) в headless-режиме рисует favicon.svg в PNG 16…256;
// 2) из PNG собирается desktop/icon/icon.ico — без зависимостей: ICO с PNG-кадрами читается Windows Vista+.
// Результат лежит в репозитории: пересобирать значок нужно только при смене favicon.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const root = resolve(import.meta.dirname, '../..');
const here = join(root, 'desktop', 'icon');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const browser = BROWSERS.find((path) => existsSync(path));
if (browser === undefined) {
  process.stderr.write('no Edge or Chrome found — the icon needs a Chromium browser to render the SVG\n');
  process.exit(1);
}

copyFileSync(join(root, 'ui', 'public', 'favicon.svg'), join(here, 'favicon.svg'));
const svg = readFileSync(join(here, 'favicon.svg'), 'utf8');
const work = join(tmpdir(), 'viboard-icon');
mkdirSync(join(here, 'png'), { recursive: true });
for (const size of SIZES) {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const html = join(work, 'icon.html');
  writeFileSync(
    html,
    `<!doctype html><style>html,body{margin:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  const out = join(here, 'png', `icon-${size}.png`);
  const run = spawnSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      `--user-data-dir=${work}`,
      `--window-size=${size},${size}`,
      '--default-background-color=00000000',
      `--screenshot=${out}`,
      `file:///${html.replaceAll('\\', '/')}`,
    ],
    { stdio: 'ignore', timeout: 60_000 },
  );
  if (run.status !== 0) {
    process.stderr.write(`render ${size}px failed (${run.status})\n`);
    process.exit(run.status ?? 1);
  }
}
rmSync(work, { recursive: true, force: true });

// ICO: заголовок (6 байт) + каталог записей (16 байт каждая) + кадры PNG подряд.
const frames = SIZES.map((size) => ({ size, data: readFileSync(join(here, 'png', `icon-${size}.png`)) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // 1 — иконка
header.writeUInt16LE(frames.length, 4);
let offset = 6 + frames.length * 16;
const directory = Buffer.alloc(frames.length * 16);
frames.forEach(({ size, data }, i) => {
  const at = i * 16;
  directory.writeUInt8(size === 256 ? 0 : size, at); // 256 кодируется нулём
  directory.writeUInt8(size === 256 ? 0 : size, at + 1);
  directory.writeUInt8(0, at + 2); // палитры нет
  directory.writeUInt8(0, at + 3);
  directory.writeUInt16LE(1, at + 4); // плоскость
  directory.writeUInt16LE(32, at + 6); // бит на пиксель
  directory.writeUInt32LE(data.length, at + 8);
  directory.writeUInt32LE(offset, at + 12);
  offset += data.length;
});
writeFileSync(join(here, 'icon.ico'), Buffer.concat([header, directory, ...frames.map((f) => f.data)]));
writeFileSync(join(here, 'icon.png'), readFileSync(join(here, 'png', 'icon-256.png')));
process.stdout.write(`icon.ico (${frames.length} sizes) and icon.png from ui/public/favicon.svg\n`);
