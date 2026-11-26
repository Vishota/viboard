// Карточка 046: сборка exe. Готовит desktop/stage (проект для electron-builder: package.json оболочки +
// копия пакета viboard — package.json, dist, protocol), запускает electron-builder и собирает лаунчер.
// Результат — desktop/out/viboard-desktop <version>.exe: один файл, portable и «типа-установка» сразу
// (слово владельца, UD-54; скрипт лаунчера — desktop/launcher.nsi).

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const stage = join(root, 'desktop', 'stage');
const out = join(root, 'desktop', 'out');
const cache = join(root, 'desktop', 'cache');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

await rm(stage, { recursive: true, force: true });
const app = join(stage, 'viboard');
await mkdir(app, { recursive: true });
// Внутри exe пакет лежит целиком: ownPackage() ищет package.json с именем viboard вверх от dist — он его находит.
// appId — из build.appId корневого package.json: окно берёт его же для панели задач (одно место).
await writeFile(
  join(app, 'package.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version, type: pkg.type, appId: pkg.build?.appId }),
);
for (const dir of ['dist', 'protocol']) await cp(join(root, dir), join(app, dir), { recursive: true });
// значок окна и панели задач лежит в корне пакета: окно берёт его по ROOT (карточка 150)
await cp(join(root, 'desktop', 'icon', 'icon.png'), join(app, 'icon.png'));

await writeFile(
  join(stage, 'package.json'),
  JSON.stringify({
    name: 'viboard-desktop',
    version: pkg.version,
    description: pkg.description,
    author: pkg.author,
    main: 'viboard/dist/desktop/main.js',
    // electron-builder берёт версию Electron из зависимостей проекта; разработческая установка — общая, корневая.
    devDependencies: { electron: pkg.devDependencies.electron },
  }),
);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// 1) распакованное приложение: electron-builder с готовым Electron из desktop/cache/electron
// (скачать один раз: см. README, «Desktop app») и значком из desktop/icon.
const unpacked = join(stage, 'unpacked');
run(process.execPath, [
  createRequire(import.meta.url).resolve('electron-builder/cli.js'),
  '--projectDir',
  stage,
  `--config.electronDist=${join(cache, 'electron')}`,
  `--config.directories.output=${unpacked}`,
  `--config.win.icon=${join(root, 'desktop', 'icon', 'icon.ico')}`,
  '--win',
  'dir',
]);

// 2) лаунчер — NSIS из desktop/cache/nsis (кладётся туда один раз из архивов electron-builder: nsis-3.0.4.1
// и плагин WinShell из nsis-resources; архивы лежат рядом в desktop/cache).
const makensis = join(cache, 'nsis', 'Bin', 'makensis.exe');
if (!existsSync(makensis)) {
  process.stderr.write('NSIS is not unpacked in desktop/cache/nsis — see README, "Desktop app"\n');
  process.exit(1);
}
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const [major = 0, minor = 0, patch = 0] = pkg.version.split('.').map(Number);
const appId = pkg.build?.appId ?? 'com.vishota.viboard';
const exe = join(out, `viboard-desktop ${pkg.version}.exe`);
run(makensis, [
  '/V2',
  '/NOCD',
  '/INPUTCHARSET',
  'UTF8',
  `/DVERSION=${pkg.version}`,
  `/DVER_MAJOR=${major}`,
  `/DVER_MINOR=${minor}`,
  `/DVER_BUILD=0`,
  `/DVER_PATCH=${patch}`,
  `/DOUT=${exe}`,
  `/DPAYLOAD=${join(unpacked, 'win-unpacked')}`,
  `/DICON=${join(root, 'desktop', 'icon', 'icon.ico')}`,
  `/DAPP_ID=${appId}`,
  `/DPUBLISHER=${typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name ?? '')}`,
  join(root, 'desktop', 'launcher.nsi'),
]);

// Контрольная сумма рядом с exe: публикация — на releases.vishota.com, файл и checksum владельцем (карточка 046).
const sum = createHash('sha256').update(readFileSync(exe)).digest('hex');
writeFileSync(`${exe}.sha256`, `${sum}  viboard-desktop ${pkg.version}.exe\n`);
process.stdout.write('sha256  ' + sum + '  viboard-desktop ' + pkg.version + '.exe' + String.fromCharCode(10));
