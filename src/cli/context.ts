// Общее для команд: где доска, кто сессия, как читать текст команды.

import { resolve } from 'node:path';
import { isBoard } from '../core/board.js';
import { boardInfo } from '../core/home.js';
import { Fail } from '../core/errors.js';
import { readText } from '../core/fs.js';
import { sessionTag } from '../core/names.js';
import { toPosix } from '../core/paths.js';
import { option, type Args } from './args.js';

export const ENV_SESSION = 'VIBOARD_SESSION';

/** Путь к доске: --board, $VIBOARD_BOARD, ./board, ~/.viboard/board. Не доска — ошибка с подсказкой. */
export function requireBoard(args: Args): string {
  const board = boardInfo(option(args, 'board')).path;
  if (!isBoard(board)) {
    throw new Fail(`board not found: ${toPosix(board)} — create one: viboard init (--here for the current directory)`);
  }
  return board;
}

/** Обязательный позиционный аргумент. */
export function need(value: string | undefined, what: string): string {
  if (value === undefined || value === '') throw new Fail(`missing argument: ${what}`);
  return value;
}

/** Тег сессии: --session <тег> или $VIBOARD_SESSION. */
export function requireSession(args: Args): string {
  try {
    return sessionTag(option(args, 'session') ?? process.env[ENV_SESSION]);
  } catch (e) {
    throw new Fail(`${(e as Error).message}; new tag — viboard session`);
  }
}

/**
 * Текст команды: позиционные слова через пробел либо `--file <файл>`.
 * Файл — надёжный путь для многострочного текста: не зависит от кавычек оболочки.
 */
export function textArg(args: Args, from: number, what: string): string {
  const file = option(args, 'file');
  const text = file === undefined ? args.positional.slice(from).join(' ') : (readText(resolve(file)) ?? '');
  const trimmed = text.trim();
  if (trimmed === '') throw new Fail(`text is required (${what}): pass it as an argument or through --file <file>`);
  return trimmed;
}
