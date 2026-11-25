import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV_BOARD } from '../../src/core/board.js';
import { createCard, moveCard } from '../../src/core/ops.js';
import { PROTOCOL_DIR } from '../../src/core/paths.js';
import { initBoard } from '../../src/core/setup.js';
import { cmdUnblock } from '../../src/cli/manage.js';
import { questionsText } from '../../src/cli/agent.js';
import { parseArgs } from '../../src/cli/args.js';
import { instant } from '../../src/cli/main.js';
import { VERSION } from '../../src/core/version.js';

// Регресс: `viboard --version` и `viboard --help` запускали интерфейс доски вместо ответа (найдено при публикации).
describe('version and help', () => {
  it('--version and -v answer the version wherever they stand', () => {
    for (const argv of [['--version'], ['-v'], ['ui', '--version']]) {
      expect(instant(parseArgs(argv)), argv.join(' ')).toBe(VERSION);
    }
  });

  it('--help, help and -h answer the usage and never start anything', () => {
    for (const argv of [['--help'], ['help'], ['-h'], ['ui', '--help']]) {
      expect(instant(parseArgs(argv)), argv.join(' ')).toContain('viboard session');
    }
  });

  it('no flag — no instant answer: the command runs as usual', () => {
    expect(instant(parseArgs([]))).toBeNull();
    expect(instant(parseArgs(['ui']))).toBeNull();
    expect(instant(parseArgs(['ls', '--log']))).toBeNull();
  });
});

// Карточка 071: mv и unblock читали тег только из --session — с тегом в $VIBOARD_SESSION команда молча
// записывала действие агента как действие владельца (session: owner в чужом логе).
describe('тег сессии: --session, затем $VIBOARD_SESSION', () => {
  const root = mkdtempSync(join(tmpdir(), 'viboard-session-'));
  const hadBoard = process.env[ENV_BOARD];
  const hadSession = process.env.VIBOARD_SESSION;
  const board = join(root, 'board');

  it('unblock с тегом только в переменной оставляет запись с этим тегом, а не владельца; mv разбирает тег так же', async () => {
    await initBoard({
      board,
      project: { name: 'T', path: root },
      protocolDir: PROTOCOL_DIR,
      version: '0.1.0-test',
      noGit: true,
    });
    const card = createCard(board, { project: 't', title: 'Session', body: 'text' });
    moveCard(board, card.id, 'blocked', { session: 'aaaa1111' });
    process.env[ENV_BOARD] = board;
    process.env.VIBOARD_SESSION = 'bbbb2222';

    cmdUnblock(parseArgs(['unblock', card.id])); // unblock пишет запись, mv — только двигает
    const log = readdirSync(join(board, 'todo', card.name, 'log')); // замка нет — карточка вернулась в todo
    expect(log.filter((f) => f.includes('-bbbb2222-') && f.endsWith('-note.md'))).toHaveLength(1);
    expect(log.filter((f) => f.includes('-owner-'))).toHaveLength(0);

    delete process.env.VIBOARD_SESSION; // без тега команда честно работает от имени владельца
    moveCard(board, card.id, 'blocked', { session: 'aaaa1111' });
    cmdUnblock(parseArgs(['unblock', card.id]));
    expect(readdirSync(join(board, 'todo', card.name, 'log')).filter((f) => f.includes('-owner-'))).toHaveLength(1);
  });

  afterAll(() => {
    if (hadBoard === undefined) delete process.env[ENV_BOARD];
    else process.env[ENV_BOARD] = hadBoard;
    if (hadSession === undefined) delete process.env.VIBOARD_SESSION;
    else process.env.VIBOARD_SESSION = hadSession;
    rmSync(root, { recursive: true, force: true });
  });
});

// Карточка 140: ответ владельца виден в `viboard show` без --log.
describe('show печатает вопрос и ответ владельца', () => {
  const root = mkdtempSync(join(tmpdir(), 'viboard-show-'));
  const hadBoard = process.env[ENV_BOARD];
  const board = join(root, 'board');

  it('отвеченный вопрос: вопрос и ответ целиком; без ответа — прямая фраза об этом', async () => {
    await initBoard({
      board,
      project: { name: 'T', path: root },
      protocolDir: PROTOCOL_DIR,
      version: '0.1.0-test',
      noGit: true,
    });
    const card = createCard(board, { project: 't', title: 'With question', body: 'text' });
    const dir = join(board, 'questions', `2026-11-26T100000Z-aaaa1111-${card.id}-q`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'README.md'), '---\nfrom: aaaa1111\ncard: 001-with-question\n---\n\nOption A or option B?');
    expect(questionsText(board, card.id)).toContain('the owner has not answered yet');
    writeFileSync(join(dir, 'answer.md'), '---\nfrom: aaaa1111\n---\n\nOption A, and keep the old names.');
    const shown = questionsText(board, card.id);
    expect(shown).toContain('Option A or option B?');
    expect(shown).toContain('Option A, and keep the old names.');
    expect(shown).toContain('answered by the owner');
  });

  afterAll(() => {
    if (hadBoard === undefined) delete process.env[ENV_BOARD];
    else process.env[ENV_BOARD] = hadBoard;
    rmSync(root, { recursive: true, force: true });
  });
});
