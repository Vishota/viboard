// Карточка 046: сборка exe. Готовит desktop/stage (проект для electron-builder: package.json оболочки +
// копия пакета viboard — package.json, dist, protocol) и запускает electron-builder. Результат — desktop/out/.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
await writeFile(join(app, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, type: pkg.type }));
for (const dir of ['dist', 'protocol']) await cp(join(root, dir), join(app, dir), { recursive: true });

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
    ...(args.length > 0 ? args : ['--win', 'portable']),
  ],
  { stdio: 'inherit', cwd: root },
);
process.exit(result.status ?? 1);
