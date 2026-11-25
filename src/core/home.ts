// Одна доска на устройство (карточка 047, UD-37): папка по умолчанию хранится в ~/.viboard/config.json,
// bare-запуск всегда приходит в неё, а не в рабочий каталог. Здесь же — перенос доски в другую папку.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { ENV_BOARD, configDir, defaultBoard, isBoard, listCards } from './board.js';
import { Fail } from './errors.js';
import { writeAtomic } from './fs.js';
import { toPosix } from './paths.js';
import type { BoardInfo, BoardSource, Config, MoveResult } from './types.js';

export type { BoardInfo, BoardSource, Config, MoveResult };

export const configFile = (): string => join(configDir(), 'config.json');

export function readConfig(): Config {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configFile(), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function writeConfig(config: Config): void {
  mkdirSync(configDir(), { recursive: true });
  writeAtomic(configFile(), `${JSON.stringify(config, null, 2)}\n`);
}

/** 1) явный путь · 2) $VIBOARD_BOARD · 3) config.json · 4) ~/.viboard/board. */
export function boardInfo(explicit?: string): BoardInfo {
  const flag = typeof explicit === 'string' ? explicit.trim() : '';
  const env = process.env[ENV_BOARD]?.trim();
  const defaultPath = resolve(readConfig().board ?? defaultBoard());
  if (flag !== '') {
    const path = resolve(flag);
    return { path, source: 'flag', defaultPath, isDefault: same(path, defaultPath), exists: isBoard(path) };
  }
  if (env)
    return {
      path: resolve(env),
      source: 'env',
      defaultPath,
      isDefault: same(resolve(env), defaultPath),
      exists: isBoard(resolve(env)),
    };
  return {
    path: defaultPath,
    source: readConfig().board ? 'config' : 'default',
    defaultPath,
    isDefault: true,
    exists: isBoard(defaultPath),
  };
}

/** Информация о конкретной доске; если это default — источник показывается как у запуска без аргументов. */
export function boardInfoAt(path: string): BoardInfo {
  const bare = boardInfo();
  return same(resolve(path), bare.path) ? bare : boardInfo(path);
}

const same = (a: string, b: string): boolean =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** Сделать существующую доску папкой по умолчанию. */
export function setDefaultBoard(path: string): BoardInfo {
  const target = resolve(path.trim());
  if (!isBoard(target)) {
    throw new Fail(`«${toPosix(target)}» is not a board — create it first: viboard init --board <path>`);
  }
  writeConfig({ ...readConfig(), board: target });
  return boardInfo();
}

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
};

const inside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** Перенос доски в другую папку: копия → сверка → удаление старой папки → новая папка становится default. */
export function moveBoard(from: string, to: string, options: { force?: boolean } = {}): MoveResult {
  const source = resolve(from.trim());
  const target = resolve(to.trim());
  if (!isBoard(source)) throw new Fail(`«${toPosix(source)}» is not a board`);
  if (inside(source, target) || inside(target, source)) {
    throw new Fail('the new folder must be outside the old one');
  }
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Fail(`«${toPosix(target)}» already exists and is not empty`);
  }
  const locked = listCards(source).filter((c) => c.lockedBy !== null);
  if (locked.length > 0 && !options.force) {
    throw new Fail(
      `agents are working on the board — ${locked.map((c) => `${c.id} (lock-${c.lockedBy ?? '?'})`).join(', ')}.\n` +
        'They read files from the old folder; stop them first, or repeat with --force to move anyway.',
    );
  }
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
  const files = walk(source);
  const mismatched = files.find((file) => {
    const copy = join(target, relative(source, file));
    return !existsSync(copy) || statSync(copy).size !== statSync(file).size;
  });
  if (mismatched !== undefined) {
    rmSync(target, { recursive: true, force: true });
    throw new Fail(`copy verification failed on ${toPosix(relative(source, mismatched))} — the board was not moved`);
  }
  const leftBehind: string[] = [];
  try {
    rmSync(source, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  } catch {
    for (const file of walk(source)) leftBehind.push(toPosix(relative(source, file)));
  }
  writeConfig({ ...readConfig(), board: target });
  return {
    from: toPosix(source),
    to: toPosix(target),
    files: files.length,
    leftBehind,
    forcedLocks: options.force ? locked.map((c) => `${c.id} (lock-${c.lockedBy ?? '?'})`) : [],
  };
}

/** Одной строкой для баннера: где доска и почему именно там. */
export function describeBoard(info: BoardInfo): string {
  const why = { flag: '--board', env: ENV_BOARD, config: 'default from config.json', default: 'default folder' }[
    info.source
  ];
  return `${toPosix(info.path)} (${why}${info.exists ? '' : ', not created yet'})`;
}
