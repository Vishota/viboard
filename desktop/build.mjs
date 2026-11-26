// Карточка 046: сборка exe. Готовит desktop/stage (проект для electron-builder: package.json оболочки +
// копия пакета viboard — package.json, dist, protocol) и запускает electron-builder. Результат — desktop/out/.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const stage = join(root, 'desktop', 'stage');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

await rm(stage, { recursive: true, force: true });
const app = join(stage, 'viboard');
await mkdir(app, { recursive: true });
// Внутри exe пакет лежит целиком: ownPackage() ищет package.json с именем viboard вверх от dist — он его находит.
// appId — из build.appId корневого package.json: окно берёт его же для панели задач (одно место, карточка 046).
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

const args = [...process.argv.slice(2)];
// Готовый Electron лежит распакованным в desktop/cache/electron — сборщик берёт его оттуда и не качает
// архив заново при каждой сборке (скачать один раз: см. README, «Desktop app»).
const electronDist = join(root, 'desktop', 'cache', 'electron');
const result = spawnSync(
  process.execPath,
  [
    createRequire(import.meta.url).resolve('electron-builder/cli.js'),
    '--projectDir',
    stage,
    `--config.electronDist=${electronDist}`,
    `--config.directories.output=${join(root, 'desktop', 'out')}`,
    `--config.win.icon=${join(root, 'desktop', 'icon', 'icon.ico')}`,
    // установщик — основной файл: постоянное место, закрепление в панели задач работает;
    // portable — один файл, но запускается из временной папки, и закрепление за ним не переживает выход
    ...(args.length > 0 ? args : ['--win', 'nsis', 'portable']),
  ],
  { stdio: 'inherit', cwd: root },
);
if (result.status !== 0) process.exit(result.status ?? 1);

// Контрольные суммы рядом с каждым exe: публикация — на releases.vishota.com, файл и checksum владельцем (карточка 046).
const out = join(root, 'desktop', 'out');
const exes = readdirSync(out).filter((name) => name.startsWith('viboard-desktop') && name.endsWith('.exe'));
if (exes.length === 0) process.exit(1);
for (const exe of exes) {
  const sum = createHash('sha256')
    .update(readFileSync(join(out, exe)))
    .digest('hex');
  writeFileSync(join(out, `${exe}.sha256`), `${sum}  ${exe}\n`);
  process.stdout.write('sha256  ' + sum + '  ' + exe + String.fromCharCode(10));
}
