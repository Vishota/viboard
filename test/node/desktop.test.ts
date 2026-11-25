import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readProjects } from '../../src/core/board.js';
import { FIRST_PROJECT, prepareDesktopBoard } from '../../src/desktop/board.js';

// Карточка 046: exe без доски создаёт её там же, куда её положил бы bare-запуск CLI; с доской — не трогает.

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

it('первый запуск exe: доски нет — создаётся доска по умолчанию с одним проектом', async () => {
  const home = mkdtempSync(join(tmpdir(), 'viboard-desktop-'));
  process.env.VIBOARD_HOME = home;
  delete process.env.VIBOARD_BOARD;
  const board = await prepareDesktopBoard();
  expect(board).toBe(join(home, 'board'));
  expect(existsSync(join(board, 'todo'))).toBe(true);
  expect(existsSync(join(board, 'AGENTS.md'))).toBe(true);
  expect(readProjects(board).map((p) => p.name)).toEqual([FIRST_PROJECT]);
  // повторный запуск — та же доска, ничего не пересоздаётся
  expect(await prepareDesktopBoard()).toBe(board);
});

it('доска из config.json или $VIBOARD_BOARD открывается как есть', async () => {
  const home = mkdtempSync(join(tmpdir(), 'viboard-desktop-'));
  process.env.VIBOARD_HOME = home;
  process.env.VIBOARD_BOARD = join(home, 'elsewhere');
  expect(await prepareDesktopBoard()).toBe(join(home, 'elsewhere'));
  expect(existsSync(join(home, 'board'))).toBe(false);
});
