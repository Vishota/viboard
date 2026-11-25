// Карточка 046: какой доской открыть окно. Без electron — чтобы проверять тестами.

import { join } from 'node:path';
import { boardInfo } from '../core/home.js';
import { PROTOCOL_DIR } from '../core/paths.js';
import { initBoard } from '../core/setup.js';
import { VERSION } from '../core/version.js';

/** Проект, с которого начинается доска при первом запуске exe: у пользователя ещё нет ни одного. */
export const FIRST_PROJECT = 'personal';

/**
 * Какой доской открыть окно. Доски по умолчанию нет — она создаётся там же, куда её кладёт bare-запуск CLI
 * (`~/.viboard/board` или путь из config.json), чтобы exe и CLI смотрели на одну папку.
 */
export async function prepareDesktopBoard(): Promise<string> {
  const info = boardInfo();
  if (info.exists) return info.path;
  await initBoard({
    board: info.path,
    project: { name: FIRST_PROJECT, path: join(info.path, '..') },
    protocolDir: PROTOCOL_DIR,
    version: VERSION,
  });
  return info.path;
}
