import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENV_BOARD } from '../../src/core/board.js';
import { boardInfo, moveBoard, setDefaultBoard } from '../../src/core/home.js';
import { toPosix } from '../../src/core/paths.js';
import { PROTOCOL_DIR } from '../../src/core/paths.js';
import { claim, createCard } from '../../src/core/ops.js';
import { initBoard } from '../../src/core/setup.js';

// Карточка 047 (UD-37): bare-запуск всегда приходит в папку по умолчанию, а не в рабочий каталог.
let root = '';
const hadEnv = process.env[ENV_BOARD];
const hadHome = process.env.VIBOARD_HOME;

async function board(name: string): Promise<string> {
  const path = join(root, name);
  await initBoard({
    board: path,
    project: { name: 'Home', path: root },
    protocolDir: PROTOCOL_DIR,
    version: '0.1.0-test',
    noGit: true,
  });
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'viboard-home-'));
  process.env.VIBOARD_HOME = join(root, 'home');
  delete process.env[ENV_BOARD];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (hadEnv === undefined) delete process.env[ENV_BOARD];
  else process.env[ENV_BOARD] = hadEnv;
  if (hadHome === undefined) delete process.env.VIBOARD_HOME;
  else process.env.VIBOARD_HOME = hadHome;
});

describe('папка доски по умолчанию', () => {
  it('без настройки — папка пользователя; рабочий каталог с ./board не подхватывается', async () => {
    const previous = process.cwd();
    process.chdir(root);
    try {
      await board('board'); // доска «не там» в рабочем каталоге — bare-запуск её игнорирует
      const info = boardInfo();
      expect(info.source).toBe('default');
      expect(info.path).toBe(join(root, 'home', 'board'));
      expect(info.exists).toBe(false);
    } finally {
      process.chdir(previous);
    }
  });

  it('порядок: --board → $VIBOARD_BOARD → config.json → папка пользователя', async () => {
    const first = await board('first');
    const second = await board('second');
    setDefaultBoard(first);
    expect(boardInfo().path).toBe(first);
    process.env[ENV_BOARD] = second;
    expect(boardInfo().source).toBe('env');
    expect(boardInfo(first).source).toBe('flag');
    expect(boardInfo().isDefault).toBe(false);
    delete process.env[ENV_BOARD];
    expect(boardInfo(first).isDefault).toBe(true);
  });

  it('default можно назначить только существующей доске', () => {
    expect(() => setDefaultBoard(join(root, 'nope'))).toThrow(/is not a board/u);
    expect(boardInfo().source).toBe('default');
  });
});

describe('перенос доски', () => {
  it('копия сверяется, старая папка удаляется, новая становится default', async () => {
    const from = await board('from');
    createCard(from, { project: 'home', title: 'Card', body: 'text' });
    const before = readdirSync(from).sort();
    const result = moveBoard(from, join(root, 'to', 'nested'));
    expect(result.files).toBeGreaterThan(5);
    expect(result.leftBehind).toEqual([]);
    expect(existsSync(from)).toBe(false);
    expect(readdirSync(join(root, 'to', 'nested')).sort()).toEqual(before);
    expect(readdirSync(join(root, 'to', 'nested', 'todo')).some((n) => n.endsWith('card'))).toBe(true);
    expect(toPosix(boardInfo().path)).toBe(result.to);
  });

  it('пока агенты держат замки — отказ со списком; --force переносит', async () => {
    const from = await board('from');
    const card = claim(from, createCard(from, { project: 'home', title: 'Busy', body: 'text' }).id, 'aaaa1111');
    expect(() => moveBoard(from, join(root, 'to'))).toThrow(new RegExp(`agents are working.*${card.id}`, 'u'));
    expect(existsSync(from)).toBe(true);
    const forced = moveBoard(from, join(root, 'to'), { force: true });
    expect(forced.forcedLocks).toEqual([`${card.id} (lock-aaaa1111)`]);
    expect(existsSync(join(root, 'to', card.column, card.name, 'lock-aaaa1111'))).toBe(true);
  });

  it('непустая папка назначения и вложенность отвергаются', async () => {
    const from = await board('from');
    mkdirSync(join(root, 'busy'));
    writeFileSync(join(root, 'busy', 'x'), '');
    expect(() => moveBoard(from, join(root, 'busy'))).toThrow(/not empty/u);
    expect(() => moveBoard(from, join(from, 'inner'))).toThrow(/outside/u);
    expect(existsSync(from)).toBe(true);
  });
});
