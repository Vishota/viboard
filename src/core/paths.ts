// Где лежит пакет и его ресурсы; путь для людей и агентов.
// ROOT — каталог package.json этого пакета: одинаково для исходников, сборки и публикации.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP } from './names.js';

interface PackageJson {
  name?: unknown;
  version?: unknown;
}

/** package.json именно этого пакета: ищем вверх от модуля, пока не встретится с именем viboard. */
export function ownPackage(
  start: string = dirname(fileURLToPath(import.meta.url)),
): { dir: string; json: PackageJson } | null {
  let dir = start;
  for (;;) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      try {
        const json = JSON.parse(readFileSync(file, 'utf8')) as PackageJson;
        if (json.name === APP) return { dir, json };
      } catch {
        /* чужой или битый package.json — идём выше */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export const ROOT = ownPackage()?.dir ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROTOCOL_DIR = join(ROOT, 'protocol');
export const UI_DIR = join(ROOT, 'dist', 'ui');

/** Файлы протокола из protocol/, которые `viboard init` кладёт в корень доски. AGENTS.md — входной, остальные — по роли. */
export const PROTOCOL_FILES = ['AGENTS.md', 'manager.md', 'reviewer.md', 'tokens.md', 'security.md'] as const;

/** Файл протокола, который не хранится в protocol/, а собирается из кода: таблица команд оболочки. */
export const SHELL_DOC = 'shell.md';

/** Путь с «/» независимо от ОС: одинаково читается в PowerShell, bash и cmd. */
export const toPosix = (p: string): string => (sep === '\\' ? p.split('\\').join('/') : p);
