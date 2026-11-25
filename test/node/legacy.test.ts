import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type * as Fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { listCards, listGhosts, oneCard } from '../../src/core/board.js';
import { checkBoard, fixBoard } from '../../src/core/check.js';
import { PROTOCOL_DIR } from '../../src/core/paths.js';
import { addLog, ask, claim, createCard, editCard, lockCard, moveCard } from '../../src/core/ops.js';
import { initBoard } from '../../src/core/setup.js';
import { listThreads, postOwnerMessage } from '../../src/core/threads.js';

// Перепроверка изменений протокола по UD-31: доски, начатые на старом протоколе, продолжают работать.
// Здесь файловая система не даёт задать mtime файла — ответ владельца всё равно пишется.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  return {
    ...actual,
    utimesSync: () => {
      throw new Error('EPERM');
    },
  };
});

const root = join(tmpdir(), `viboard-legacy-${process.pid}`);
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function fresh(name: string): Promise<string> {
  const board = join(root, name);
  await initBoard({
    board,
    project: { name: 'Legacy', path: root },
    protocolDir: PROTOCOL_DIR,
    version: '0.1.0-test',
    noGit: true,
  });
  return board;
}

describe('старая доска', () => {
  it('.lock-<tag> читается как занятая карточка; check подсказывает, fix переименовывает', async () => {
    const board = await fresh('lock');
    const card = claim(board, createCard(board, { project: 'legacy', title: 'Old lock', body: 'text' }).id, 'aaaa1111');
    renameSync(join(card.dir, 'lock-aaaa1111'), join(card.dir, '.lock-aaaa1111'));
    expect(oneCard(board, card.id).lockedBy).toBe('aaaa1111');

    const texts = checkBoard(board, { protocolVersion: '0.1.0-test' }).map((f) => `${f.level}: ${f.text}`);
    expect(texts.some((t) => t.startsWith('info: ') && t.includes('.lock-<tag>'))).toBe(true);
    expect(texts.filter((t) => t.startsWith('warn: '))).toEqual([]);

    expect(fixBoard(board)).toEqual([`${card.name}: .lock-aaaa1111 → lock-aaaa1111`]);
    expect(oneCard(board, card.id).lockedBy).toBe('aaaa1111');
  });

  it('ответ владельца пишется и тогда, когда mtime файла задать нельзя', async () => {
    const board = await fresh('answer');
    createCard(board, { project: 'legacy', title: 'Thread', body: 'text' });
    const thread = '2026-11-20T100000Z-aaaa1111-001-thread-q';
    mkdirSync(join(board, 'questions', thread), { recursive: true });
    writeFileSync(
      join(board, 'questions', thread, 'README.md'),
      '---\nfrom: aaaa1111\ncard: 001-thread\n---\n\nQuestion',
    );

    expect(postOwnerMessage(board, thread, 'Answer')).toBe('answer.md');
    expect(listThreads(board)[0]?.messages.map((m) => [m.side, m.body])).toEqual([
      ['agent', 'Question'],
      ['user', 'Answer'],
    ]);
  });
});

describe('запись старого формата', () => {
  it('check указывает на fix; fix сжимает id сессии среды до тега', async () => {
    const board = await fresh('entry');
    const dir = join(board, 'log');
    mkdirSync(dir, { recursive: true });
    const legacy = '2026-11-20T171919Z-sess_f58fead9-b386-406b-881c-34db1fa6b192-002-task-done.md';
    writeFileSync(join(dir, legacy), '---\ntype: done\n---\n\nold');
    const before = checkBoard(board, { protocolVersion: '0.1.0-test' }).map((f) => f.text);
    expect(before.some((t) => t.includes(legacy) && t.endsWith('name is out of format — viboard fix'))).toBe(true);

    expect(fixBoard(board)).toEqual([`log/${legacy} → 2026-11-20T171919Z-f58fead9-002-task-done.md`]);
    expect(checkBoard(board, { protocolVersion: '0.1.0-test' })).toEqual([]);
  });
});

// Карточка 050: смена приоритета переименовывает папку; запись в старый путь создавала второй каталог с тем же id.
describe('два каталога с одним id', () => {
  it('обращение по точному имени работает; check видит дубль и «призрака»; fix переносит содержимое и удаляет призрака', async () => {
    const board = await fresh('duplicate');
    const card = createCard(board, { project: 'legacy', title: 'Dup', body: 'text' });
    editCard(board, card.id, { priority: 1 }); // владелец поднял приоритет — папка переименована
    const ghost = join(board, card.column, card.name);
    mkdirSync(join(ghost, 'log'), { recursive: true }); // кто-то написал в старый путь
    writeFileSync(join(ghost, 'log', '2026-11-24T100000Z-bbbb2222-note.md'), '---\ntype: note\n---\n\nstale');

    expect(oneCard(board, 'legacy-P1-001-dup').priority).toBe(1);
    expect(oneCard(board, card.id).name).toBe('legacy-P1-001-dup'); // призрак не мешает поиску по id
    expect(listCards(board).map((c) => c.name)).toEqual(['legacy-P1-001-dup']); // призрак — не карточка

    const texts = checkBoard(board, { protocolVersion: '0.1.0-test' }).map((f) => `${f.level}: ${f.text}`);
    expect(texts.some((t) => t.startsWith('error: ') && t.includes('leftover folder of legacy-P1-001-dup'))).toBe(true);

    const done = fixBoard(board);
    expect(done.some((line) => line.endsWith('leftover folder removed'))).toBe(true);
    expect(existsSync(ghost)).toBe(false);
    expect(listCards(board)[0]?.log).toEqual(['2026-11-24T100000Z-bbbb2222-note.md']);
    expect(checkBoard(board, { protocolVersion: '0.1.0-test' })).toEqual([]);
  });

  it('запись по исчезнувшему пути не пересоздаёт папку', async () => {
    const board = await fresh('stale');
    const card = createCard(board, { project: 'legacy', title: 'Stale', body: 'text' });
    editCard(board, card.id, { priority: 1 }); // папка переименована
    const stale = { ...card, priority: 1 };
    expect(() => addLog(stale, { type: 'note', session: 'bbbb2222', text: 'late' })).toThrow(/renamed or moved/u);
    expect(() => lockCard(stale, 'bbbb2222')).toThrow(/renamed or moved/u);
    expect(existsSync(card.dir)).toBe(false);
    expect(listGhosts(board)).toEqual([]);
  });
});

describe('viboard ask', () => {
  it('уводит в blocked/ только из todo/ и doing/; карточку в review/ оставляет на месте', async () => {
    const board = await fresh('ask');
    const card = createCard(board, { project: 'legacy', title: 'Ask', body: 'text' });
    moveCard(board, card.id, 'review');
    const { card: after } = ask(board, card.id, 'cccc3333', 'Question?\n\n## Options\n\n- A\n- B');
    expect(after.column).toBe('review');
    expect(listThreads(board)[0]?.card).toBe(card.id);
  });
});
