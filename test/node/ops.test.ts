import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listCards, oneCard, readCard, readEntries, readLabels, readProjects } from '../../src/core/board.js';
import { checkBoard, fixBoard } from '../../src/core/check.js';
import { Fail } from '../../src/core/errors.js';
import { readText, writeAtomic } from '../../src/core/fs.js';
import { PROTOCOL_DIR } from '../../src/core/paths.js';
import {
  addColumn,
  addProject,
  ask,
  claim,
  createCard,
  deleteCard,
  deleteColumn,
  editCard,
  moveCard,
  note,
  readyForReview,
  safeFilename,
  unblock,
  verdictFail,
  verdictPass,
} from '../../src/core/ops.js';
import { initBoard } from '../../src/core/setup.js';
import { listThreads, postOwnerAttachment, postOwnerMessage } from '../../src/core/threads.js';
import { timeline } from '../../src/core/timeline.js';
import type { Card } from '../../src/core/types.js';

const root = mkdtempSync(join(tmpdir(), 'viboard-ops-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
async function fresh(): Promise<string> {
  const board = join(root, `board-${++counter}`);
  await initBoard({
    board,
    project: { name: 'Тест', path: root },
    protocolDir: PROTOCOL_DIR,
    version: '0.1.0-test',
    noGit: true,
  });
  return board;
}

const T0 = new Date('2026-11-23T10:00:00Z');
const hoursLater = (h: number): Date => new Date(Date.now() + h * 3600e3);
/** Возраст лока = mtime его каталога; в тестах время лока задаём явно. */
const ageLock = (dir: string, tag: string, hours: number): void => {
  const past = new Date(Date.now() - hours * 3600e3);
  utimesSync(join(dir, `lock-${tag}`), past, past);
};
const card = (board: string, title: string, extra: { project?: string; priority?: number; body?: string } = {}): Card =>
  createCard(board, {
    project: extra.project ?? 'app',
    title,
    body: extra.body ?? `Сделать: ${title}`,
    priority: extra.priority,
  });

describe('карточки', () => {
  it('создание: имя из проекта, приоритета и id; README с frontmatter', async () => {
    const board = await fresh();
    const a = card(board, 'Проверить типографику', { priority: 1, body: 'Тело задачи' });
    expect(a.name).toBe('app-001-proverit-tipografiku');
    expect(a.column).toBe('todo');
    expect(a.id).toBe('001-proverit-tipografiku');
    expect(a.lockedBy).toBeNull();
    const readme = readText(join(a.dir, 'README.md')) ?? '';
    expect(readme).toContain('id: 001-proverit-tipografiku');
    expect(readme).toContain('priority: 1');
    expect(readme).toContain('Тело задачи');
    expect(existsSync(join(a.dir, 'log'))).toBe(true);
    expect(card(board, 'Вторая').name).toBe('app-002-vtoraya');
  });

  it('неверные проект, приоритет, название — ошибка', async () => {
    const board = await fresh();
    expect(() => createCard(board, { project: 'Bad Project', title: 'x', body: 'y' })).toThrow(/project id/u);
    expect(() => createCard(board, { project: 'app', title: 'x', body: 'y', priority: 9 })).toThrow(/1–5/u);
    expect(() => createCard(board, { project: 'app', title: '   ', body: 'y' })).toThrow(/title/u);
    expect(() => createCard(board, { project: 'app', title: 'x', body: '' })).toThrow(/description/u);
    expect(listCards(board)).toHaveLength(0);
  });

  it('правка: смена приоритета не переименовывает каталог (UD-40), смена проекта — переименовывает; чужие поля не теряются', async () => {
    const board = await fresh();
    const a = card(board, 'Задача');
    writeAtomic(
      join(a.dir, 'README.md'),
      `---\nid: ${a.id}\nproject: app\ntitle: Задача\npriority: 3\ndod:\n  - Критерий один\n  - Критерий два\n---\n\nТело\n`,
    );
    const b = editCard(board, a.id, { priority: 1, title: 'Задача (срочно)' });
    expect(b).toMatchObject({ name: a.name, dir: a.dir, priority: 1 });
    expect(existsSync(a.dir)).toBe(true);
    const readme = readText(join(b.dir, 'README.md')) ?? '';
    expect(readme).toContain('dod:\n  - Критерий один\n  - Критерий два');
    expect(readme).toContain('title: Задача (срочно)');
    const c = editCard(board, '001', { project: 'other' });
    expect(c.name).toBe('other-001-zadacha');
    expect(() => editCard(board, '001', { body: ' ' })).toThrow(/empty/u);
  });
});

describe('клэйм', () => {
  it('lock-<тег>, запись, doing/; чужая сессия отталкивается', async () => {
    const board = await fresh();
    const a = card(board, 'Первая');
    const claimed = claim(board, a.id, 'aaaa1111', { now: T0 });
    expect(claimed.column).toBe('doing');
    expect(claimed.lockedBy).toBe('aaaa1111');
    expect(readdirSync(claimed.dir)).toContain('lock-aaaa1111');
    const entries = readEntries(claimed);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.text).toContain('claim');
    expect(entries[0]?.file).toMatch(/^2026-11-23T100000Z-aaaa1111-note\.md$/u);
    expect(() => claim(board, a.id, 'bbbb2222', { now: T0 })).toThrow(/taken \(lock-aaaa1111\)/u);
    expect(claim(board, a.id, 'aaaa1111', { now: T0 }).lockedBy).toBe('aaaa1111'); // повторно — своя
  });

  it('WIP: не больше двух карточек в doing/ на сессию', async () => {
    const board = await fresh();
    const [a, b, c] = [card(board, 'Одна'), card(board, 'Две'), card(board, 'Три')];
    claim(board, a.id, 'aaaa1111', { now: T0 });
    claim(board, b.id, 'aaaa1111', { now: T0 });
    expect(() => claim(board, c.id, 'aaaa1111', { now: T0 })).toThrow(/WIP.*limit 2/u);
    expect(claim(board, c.id, 'cccc3333', { now: T0 }).lockedBy).toBe('cccc3333');
  });

  it('из backlog/ и review/ не берётся; устаревший лок (старше 24 ч) перехватывается с записью', async () => {
    const board = await fresh();
    const [a, b] = [card(board, 'Черновик'), card(board, 'Работа')];
    renameSync(a.dir, join(board, 'backlog', a.name));
    expect(() => claim(board, a.id, 'aaaa1111', { now: T0 })).toThrow(/backlog/u);

    claim(board, b.id, 'aaaa1111', { now: T0 });
    expect(() => claim(board, b.id, 'bbbb2222', { now: hoursLater(23) })).toThrow(/taken/u);
    ageLock(oneCard(board, b.id).dir, 'aaaa1111', 25);
    const taken = claim(board, b.id, 'bbbb2222', { now: new Date() });
    expect(taken.lockedBy).toBe('bbbb2222');
    expect(readdirSync(taken.dir)).not.toContain('lock-aaaa1111');
    expect(readEntries(taken).map((e) => e.text)).toContain('takeover: removed lock-aaaa1111 (older than 24h)');
    expect(readEntries(taken).at(-1)?.text).toBe('claim: session bbbb2222'); // вторая запись той же сессии — следующая секунда
  });
});

describe('вопрос и вердикты', () => {
  it('ask: тред, запись, blocked/; лок держателя остаётся; unblock возвращает в doing/', async () => {
    const board = await fresh();
    const a = claim(board, card(board, 'Спорная').id, 'aaaa1111', { now: T0 });
    const { card: blocked, thread } = ask(
      board,
      a.id,
      'aaaa1111',
      'Какая база?\n\n## Options\n\n- 16px — рекомендую\n- 18px',
      { now: T0 },
    );
    expect(thread).toBe('2026-11-23T100000Z-aaaa1111-001-spornaya-q');
    expect(readText(join(board, 'questions', thread, 'README.md'))).toContain('## Options');
    expect(blocked.column).toBe('blocked');
    expect(blocked.lockedBy).toBe('aaaa1111');
    expect(readEntries(blocked).at(-1)?.type).toBe('question');

    const back = unblock(board, a.id);
    expect(back.column).toBe('doing');
    expect(readEntries(back).at(-1)?.text).toContain('→ doing/');
  });

  it('готово к проверке: только держатель; review/ без лока; затем fail → doing/, pass → done/ и запись в log/ доски', async () => {
    const board = await fresh();
    const a = claim(board, card(board, 'Сделать').id, 'aaaa1111', { now: T0 });
    expect(() => readyForReview(board, a.id, 'bbbb2222', 'готово')).toThrow(/another session/u);
    const ready = readyForReview(board, a.id, 'aaaa1111', 'Сделано, проверено прогоном', { now: T0 });
    expect(ready.column).toBe('review');
    expect(ready.lockedBy).toBeNull();
    expect(readEntries(ready).at(-1)).toMatchObject({ type: 'review', verdict: 'ready', tag: 'aaaa1111' });

    const failed = verdictFail(board, a.id, 'bbbb2222', 'На мобильной сетка едет', { now: T0 });
    expect(failed.column).toBe('doing');
    expect(readEntries(failed).at(-1)).toMatchObject({ verdict: 'fail', text: 'На мобильной сетка едет' });

    expect(() => verdictPass(board, a.id, 'bbbb2222', 'ок')).toThrow(/applies only to a card in review/u);
    claim(board, a.id, 'cccc3333', { now: T0 }); // возьмёт следующий исполнитель
    readyForReview(board, a.id, 'cccc3333', 'исправлено', { now: T0 });
    const done = verdictPass(board, a.id, 'bbbb2222', 'прогон воспроизведён', { now: T0 });
    expect(done.column).toBe('done');
    expect(readdirSync(join(board, 'log')).some((f) => f.endsWith('-bbbb2222-001-sdelat-done.md'))).toBe(true);
  });
});

describe('перемещение и удаление', () => {
  it('занятую карточку двигает только держатель; владелец в done/ пишет запись в log/ доски', async () => {
    const board = await fresh();
    const a = claim(board, card(board, 'Занятая').id, 'aaaa1111', { now: T0 });
    expect(() => moveCard(board, a.id, 'todo')).toThrow(/lock holder/u);
    expect(moveCard(board, a.id, 'todo', { force: true }).lockedBy).toBeNull();
    expect(() => moveCard(board, a.id, 'nowhere')).toThrow(/no column «nowhere»/u);
    const b = card(board, 'Свободная');
    moveCard(board, b.id, 'done');
    expect(readdirSync(join(board, 'log')).some((f) => f.endsWith(`-owner-${b.id}-done.md`))).toBe(true);
  });

  it('удаление: занятую нельзя, свободную — можно', async () => {
    const board = await fresh();
    const a = claim(board, card(board, 'Останется').id, 'aaaa1111', { now: T0 });
    expect(() => deleteCard(board, a.id)).toThrow(/only a free card can be deleted/u);
    const b = card(board, 'Удалится');
    expect(deleteCard(board, b.id)).toBe('todo');
    expect(existsSync(b.dir)).toBe(false);
  });
});

describe('колонки и проекты', () => {
  it('колонки добавляются в конец и удаляются только пустые', async () => {
    const board = await fresh();
    expect(addColumn(board, 'someday')).toBe('someday');
    expect(readText(join(board, 'columns.yml'))).toContain('someday');
    expect(() => addColumn(board, 'someday')).toThrow(/already exists/u);
    expect(() => addColumn(board, 'Bad Name')).toThrow(/lowercase Latin letters/u);
    card(board, 'В новой', { project: 'app' });
    moveCard(board, '001', 'someday');
    expect(() => deleteColumn(board, 'someday')).toThrow(/is not empty/u);
    moveCard(board, '001', 'todo');
    expect(deleteColumn(board, 'someday')).toBe('someday');
    expect(existsSync(join(board, 'someday'))).toBe(false);
  });

  it('проект добавляется и читается обратно', async () => {
    const board = await fresh();
    const p = addProject(board, { name: 'Сайт', path: 'E:\\proj\\site' });
    expect(p).toEqual({ id: 'sayt', name: 'Сайт', path: 'E:\\proj\\site' });
    expect(readProjects(board).map((x) => x.id)).toEqual(['test', 'sayt']);
    expect(() => addProject(board, { name: 'Сайт' })).toThrow(/already exists/u);
    expect(card(board, 'Задача сайта', { project: 'sayt' }).name).toBe('sayt-001-zadacha-sayta');
  });
});

describe('вложения', () => {
  it('имя файла очищается от пути и запрещённых символов', () => {
    expect(safeFilename('..\\..\\etc\\passwd')).toBe('passwd');
    expect(safeFilename('отчёт: итоги?.png')).toBe('отчёт_ итоги_.png');
    expect(safeFilename('CON.txt')).toBe('_CON.txt');
    expect(safeFilename('  имя...  ')).toBe('имя');
    expect(() => safeFilename('../')).toThrow(Fail);
  });
});

describe('треды', () => {
  it('первое сообщение владельца — answer.md, дальше — msg-файлы; вложение — файл-сообщение', async () => {
    const board = await fresh();
    const a = card(board, 'Вопрос');
    const { thread } = ask(board, a.id, 'aaaa1111', 'Сколько столбцов?\n\n## Options\n\n- Два\n- Три', { now: T0 });
    expect(listThreads(board)[0]).toMatchObject({ dir: thread, card: a.id, answered: false, lastFrom: 'agent' });

    expect(postOwnerMessage(board, thread, 'Три')).toBe('answer.md');
    expect(readText(join(board, 'questions', thread, 'answer.md'))).toBe('Три\n');
    const second = postOwnerMessage(board, thread, 'И кнопку добавить');
    // Сообщение владельца пишется реальными часами сервера, а не `now` сессии.
    expect(second).toMatch(/^\d{4}-\d{2}-\d{2}T\d{6}Z-owner-msg\.md$/u);
    const attachment = postOwnerAttachment(board, thread, 'скрин..png', Buffer.from('png'));
    expect(attachment).toMatch(/-owner-att-скрин\.\.png$/u);

    const t = listThreads(board)[0];
    expect(t?.answered).toBe(true);
    expect(t?.lastFrom).toBe('user');
    expect(t?.messages.map((m) => m.side)).toEqual(['agent', 'user', 'user', 'user']);
    expect(t?.messages.at(-1)?.attachment).toBe(attachment);
    expect(() => postOwnerMessage(board, '../x', 'вред')).toThrow(/invalid thread name/u);
  });

  it('старый тред с длинным id сессии читается', async () => {
    const board = await fresh();
    const dir = join(board, 'questions', '2026-11-20T171226Z-sess_f58fead9-b386-406b-881c-34db1fa6b192---q');
    mkdirSync(dir, { recursive: true });
    writeAtomic(join(dir, 'README.md'), '---\nfrom: sess_f58fead9-b386-406b-881c-34db1fa6b192\ncard: -\n---\n\nВопрос');
    const t = listThreads(board)[0];
    expect(t?.card).toBe('');
    expect(t?.messages[0]).toMatchObject({ side: 'agent', session: 'f58fead9', body: 'Вопрос' });
  });
});

describe('чек-лист менеджера и лента', () => {
  it('находит нарушения и предлагает команды; fix выравнивает имена', async () => {
    const board = await fresh();
    const a = claim(board, card(board, 'С тегом').id, 'aaaa1111', { now: T0 });
    ageLock(a.dir, 'aaaa1111', 30);
    const b = card(board, 'Без тега');
    moveCard(board, b.id, 'doing');
    const c = card(board, 'На проверке');
    moveCard(board, c.id, 'review');
    const d = card(board, 'Закрыта вручную');
    renameSync(d.dir, join(board, 'done', d.name));
    const e = card(board, 'Заблокирована молча');
    moveCard(board, e.id, 'blocked');

    const texts = checkBoard(board, { protocolVersion: '0.1.0-test' }).map((f) => `${f.level}: ${f.text}`);
    expect(texts, texts.join('\n')).toContain(
      'warn: doing/app-002-bez-tega: no lock-<tag> — the claim was never confirmed → viboard mv 002-bez-tega todo',
    );
    expect(texts.some((t) => t.includes(`${a.name}: lock-aaaa1111 is older than 30h`))).toBe(true);
    expect(texts.some((t) => t.includes('review/app-003-na-proverke: waiting for a reviewer'))).toBe(true);
    expect(texts.some((t) => t.includes(`${d.name}: no entry in the board log/`))).toBe(true);
    expect(texts.some((t) => t.includes(`${e.name}: blocked without a thread`))).toBe(true);
    expect(texts.filter((t) => t.startsWith('error:'))).toHaveLength(0);
  });

  it('имя ≠ frontmatter — замечание; fixBoard переименовывает', async () => {
    const board = await fresh();
    const a = card(board, 'Сбитое имя');
    renameSync(a.dir, join(board, 'todo', 'app-005-sbitoe-imya'));
    const texts = checkBoard(board, { protocolVersion: '0.1.0-test' }).map((f) => f.text);
    expect(texts.some((t) => t.includes('expected app-001-sbitoe-imya (viboard fix)'))).toBe(true);
    expect(fixBoard(board)).toEqual(['app-005-sbitoe-imya → app-001-sbitoe-imya']);
    expect(oneCard(board, '001').name).toBe('app-001-sbitoe-imya');
  });

  it('лента собирает решения, вопросы и вердикты из карточек, новые сверху', async () => {
    const board = await fresh();
    const a = claim(board, card(board, 'События').id, 'aaaa1111', { now: T0 });
    note(board, a.id, 'aaaa1111', 'заметка', { now: T0 });
    ask(board, a.id, 'aaaa1111', 'Вопрос владельцу', { now: new Date(T0.getTime() + 3600e3) });
    const items = timeline(board);
    expect(items.map((i) => i.type)).toEqual(['question']); // заметка — не событие ленты
    expect(items[0]).toMatchObject({ card: a.id, verdict: null, title: 'События' });
    expect(items[0]?.text).toContain('Вопрос владельцу → questions/');
  });

  it('readCard читает карточку по колонке', async () => {
    const board = await fresh();
    const a = card(board, 'Читается');
    expect(readCard(board, 'todo', a.name).title).toBe('Читается');
    expect(readCard(board, 'todo', a.name).meta.priority).toBe('3');
  });
});

// Карточка 059 (UD-46): ярлыки — во frontmatter карточки, известный список — labels.yml в корне доски.
describe('ярлыки', () => {
  it('создание и правка с ярлыками: frontmatter, известный список, повторы и неверные имена', async () => {
    const board = await fresh();
    const a = createCard(board, {
      project: 'app',
      title: 'Labeled',
      body: 'text',
      labels: ['v0.2.0', 'V0.2.0', 'bug'],
    });
    expect(a.labels).toEqual(['v0.2.0', 'bug']);
    expect(readText(join(a.dir, 'README.md'))).toContain('labels: [v0.2.0, bug]');
    expect(readLabels(board)).toEqual(['v0.2.0', 'bug']);
    const plain = createCard(board, { project: 'app', title: 'Plain', body: 'text' });
    expect(plain.labels).toEqual([]);
    expect(readText(join(plain.dir, 'README.md'))).not.toContain('labels:');

    const edited = editCard(board, a.id, { labels: ['bug', 'ui'] });
    expect(edited.labels).toEqual(['bug', 'ui']);
    expect(readLabels(board)).toEqual(['v0.2.0', 'bug', 'ui']);
    expect(() => createCard(board, { project: 'app', title: 'Bad', body: 'text', labels: ['Not Valid'] })).toThrow(
      /a label is lowercase/u,
    );
    expect(editCard(board, plain.id, { title: 'Renamed' }).labels).toEqual([]);
  });

  it('fix ставит ярлык agent карточкам, созданным агентами до ярлыков; check указывает на них', async () => {
    const board = await fresh();
    const marked = card(board, 'От агента');
    writeAtomic(
      join(marked.dir, 'README.md'),
      `---\nid: ${marked.id}\nproject: app\ntitle: От агента\npriority: 3\n---\n\n**Автор карточки — агент** (менеджер): текст.\n`,
    );
    const own = card(board, 'От владельца');
    const before = checkBoard(board, { protocolVersion: '0.1.0-test' }).map((f) => f.text);
    expect(before.some((t) => t.includes('made by an agent but has no label «agent» — viboard fix'))).toBe(true);

    fixBoard(board);
    expect(oneCard(board, marked.id).labels).toEqual(['agent']);
    expect(oneCard(board, own.id).labels).toEqual([]);
    expect(readLabels(board)).toContain('agent');
    expect(
      checkBoard(board, { protocolVersion: '0.1.0-test' })
        .map((f) => f.text)
        .some((t) => t.includes('no label')),
    ).toBe(false);
  });
});
