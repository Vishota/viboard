// Операции над доской — «руки»: агента (claim, ask, review, вердикты), владельца через UI (карточки, колонки,
// проекты, сообщения), менеджера (mv, unblock). Каждая операция либо оставляет доску целостной, либо не начинается.

import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import {
  assertAlive,
  expectedName,
  listCards,
  oneCard,
  readCard,
  readCardDoc,
  readColumns,
  readLabels,
  readProjects,
  writeColumns,
  writeLabels,
  writeProjects,
} from './board.js';
import { Fail } from './errors.js';
import { ensureDir, movePath, writeAtomic } from './fs.js';
import { emptyDoc, formatDoc, type FieldValue } from './frontmatter.js';
import {
  LABEL_RE,
  LEGACY_LOCK,
  LOCK,
  LOCK_STALE_MS,
  OWNER,
  PROJECT_RE,
  SLUG_RE,
  WIP_LIMIT,
  cardName,
  nextId,
  projectId,
  sessionTag,
  slugify,
  stamp,
  type LogKind,
  type Verdict,
} from './names.js';
import type { Card, CardInput, CardPatch, Project } from './types.js';

export function requireText(text: string | undefined, what: string): string {
  const t = (text ?? '').trim();
  if (!t) throw new Fail(`text is required: ${what} — as an argument or through --file <file>`);
  return t;
}

/** Значение для сообщения об ошибке: строка — как есть, остальное — JSON. */
const shown = (v: unknown): string => (typeof v === 'string' ? v : (JSON.stringify(v) ?? '?'));

export function parsePriority(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new Fail(`priority is an integer 1–5 (1 is the highest); got «${shown(value)}»`);
  }
  return n;
}

export function parseProjectId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!PROJECT_RE.test(id)) {
    throw new Fail(`project id is lowercase Latin letters, digits, dots and hyphens (1–32); got «${id}»`);
  }
  return id;
}

const localDate = (d: Date = new Date()): string => {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function assertColumn(board: string, column: string): void {
  if (!readColumns(board).includes(column)) throw new Fail(`no column «${column}» on the board`);
}

function moveTo(board: string, card: Card, to: string): Card {
  if (card.column === to) return card;
  assertColumn(board, to);
  movePath(card.dir, join(board, to, card.name));
  return readCard(board, to, card.name);
}

function renameTo(board: string, card: Card, name: string): Card {
  if (card.name === name) return card;
  try {
    movePath(card.dir, join(board, card.column, name));
  } catch (e) {
    throw new Fail(
      `${card.name}: cannot rename the directory — the card is open in another process. ` +
        `Data is updated; the manager will fix the name (viboard fix). Reason: ${(e as Error).message}`,
    );
  }
  return readCard(board, card.column, name);
}

// --- карточки ---

export function createCard(board: string, input: CardInput): Card {
  const title = requireText(input.title, 'task title');
  const body = requireText(input.body, 'task description');
  const project = parseProjectId(input.project);
  const priority = parsePriority(input.priority ?? 3);
  const columns = readColumns(board);
  const column = input.column ?? (columns.includes('todo') ? 'todo' : columns[0]);
  if (!column || !columns.includes(column)) throw new Fail(`no column «${String(input.column)}» on the board`);
  const slug = input.slug === undefined ? slugify(title) : input.slug;
  if (!SLUG_RE.test(slug)) throw new Fail(`a slug is lowercase Latin letters, digits and hyphens; got «${slug}»`);
  const id = nextId(
    listCards(board).map((c) => c.id),
    slug,
  );
  const labels = parseLabels(input.labels);
  registerLabels(board, labels);
  const name = cardName(project, id);
  const dir = join(board, column, name);
  ensureDir(join(board, column));
  try {
    mkdirSync(dir); // атомарно: совпадение id исключено, пока каталог создаётся, а не проверяется
  } catch {
    throw new Fail(`card ${name} already exists`);
  }
  ensureDir(join(dir, 'log'));
  writeAtomic(
    join(dir, 'README.md'),
    formatDoc(
      emptyDoc(),
      { id, project, title, priority, depends_on: [], created: localDate(), ...(labels.length > 0 ? { labels } : {}) },
      body,
    ),
  );
  return readCard(board, column, name);
}

/** Правка frontmatter/постановки; при смене проекта каталог переименовывается. Приоритет имени не меняет (UD-40). */
export function editCard(board: string, ref: string, patch: CardPatch): Card {
  let card = oneCard(board, ref);
  assertAlive(card);
  const doc = readCardDoc(card);
  const fm: Record<string, FieldValue | number | undefined> = {};
  if (patch.title !== undefined) fm.title = requireText(patch.title, 'task title');
  if (patch.body !== undefined && patch.body.trim() === '') throw new Fail('description cannot be empty');
  if (patch.project !== undefined) fm.project = parseProjectId(patch.project);
  if (patch.priority !== undefined) fm.priority = parsePriority(patch.priority);
  if (patch.labels !== undefined) {
    fm.labels = parseLabels(patch.labels);
    registerLabels(board, fm.labels);
  }
  assertAlive(card);
  writeAtomic(join(card.dir, 'README.md'), formatDoc(doc, fm, patch.body ?? doc.body));
  card = readCard(board, card.column, card.name);
  return renameTo(board, card, expectedName(card));
}

export interface MoveOptions {
  /** Тег того, кто двигает; по умолчанию — владелец. */
  session?: string;
  /** Двигать занятую карточку (снять лок). */
  force?: boolean;
  now?: Date;
}

/** Перемещение между колонками. Занятую карточку двигает только держатель лока (или --force). */
export function moveCard(board: string, ref: string, to: string, options: MoveOptions = {}): Card {
  let card = oneCard(board, ref);
  if (card.column === to) return card;
  assertColumn(board, to);
  const tag = sessionTag(options.session ?? OWNER, { owner: true });
  if (card.lockedBy) {
    if (!options.force && card.lockedBy !== tag) {
      throw new Fail(
        `${card.name}: in progress (lock-${card.lockedBy}) — only the lock holder moves it; --force removes the lock`,
      );
    }
    card = unlockCard(board, card, card.lockedBy);
  }
  card = moveTo(board, card, to);
  if (to === 'done') {
    const who = tag === OWNER ? 'by the owner' : `by session ${tag}`;
    addBoardLog(board, {
      type: 'done',
      session: tag,
      card: card.id,
      text: `Moved to done/ ${who}.`,
      now: options.now,
      asOwner: tag === OWNER,
    });
  }
  return card;
}

export function deleteCard(board: string, ref: string): string {
  const card = oneCard(board, ref);
  if (card.lockedBy) {
    throw new Fail(`${card.name}: in progress (lock-${card.lockedBy}) — only a free card can be deleted`);
  }
  rmSync(card.dir, { recursive: true, force: true });
  return card.column;
}

// --- колонки и проекты ---

const COLUMN_NAME_RE = /^[a-z][a-z0-9-]{1,23}$/u;

export function addColumn(board: string, name: string): string {
  const n = name.trim();
  if (!COLUMN_NAME_RE.test(n))
    throw new Fail('a column name is lowercase Latin letters, digits and hyphens, 2–24 characters');
  const columns = readColumns(board);
  if (columns.includes(n)) throw new Fail(`column «${n}» already exists`);
  ensureDir(join(board, n));
  writeColumns(board, [...columns, n]);
  return n;
}

export function deleteColumn(board: string, name: string): string {
  const columns = readColumns(board);
  if (!columns.includes(name)) throw new Fail(`no column «${name}»`);
  if (columns.length <= 1) throw new Fail('the last column cannot be deleted');
  const dir = join(board, name);
  let inside: string[] = [];
  try {
    inside = readdirSync(dir);
  } catch {
    /* каталога нет — пусто */
  }
  if (inside.some((f) => !f.startsWith('.'))) {
    throw new Fail(`column «${name}» is not empty — move its cards out first`);
  }
  rmSync(dir, { recursive: true, force: true });
  writeColumns(
    board,
    columns.filter((c) => c !== name),
  );
  return name;
}

export function addProject(board: string, input: { id?: string; name: string; path?: string }): Project {
  const name = requireText(input.name, 'project name');
  const id = parseProjectId(input.id ?? projectId(name));
  const projects = readProjects(board);
  if (projects.some((p) => p.id === id)) throw new Fail(`project «${id}» already exists`);
  const project: Project = { id, name, path: input.path?.trim() ?? '' };
  writeProjects(board, [...projects, project]);
  return project;
}

// --- лок и записи ---

export function lockCard(card: Card, session: string): Card {
  assertAlive(card);
  const tag = sessionTag(session);
  try {
    mkdirSync(join(card.dir, `${LOCK}${tag}`)); // атомарный клэйм: не создался — занято
  } catch {
    throw new Fail(`${card.name}: taken (lock-${card.lockedBy ?? '?'})`);
  }
  return readCard(card.board, card.column, card.name);
}

export function unlockCard(board: string, card: Card, tag: string): Card {
  for (const prefix of [LOCK, LEGACY_LOCK]) {
    rmSync(join(card.dir, `${prefix}${tag}`), { recursive: true, force: true });
  }
  return readCard(board, card.column, card.name);
}

export interface LogInput {
  type: LogKind;
  session: string;
  text: string;
  verdict?: Verdict;
  now?: Date;
  /** Только для UI: писать от тега owner. */
  asOwner?: boolean;
}

const entryMeta = (entry: LogInput & { card: string }): Record<string, FieldValue | number | undefined> => {
  const fm: Record<string, FieldValue | number | undefined> = {
    type: entry.type,
    card: entry.card,
    session: sessionTag(entry.session, { owner: entry.asOwner }),
  };
  if (entry.verdict) fm.verdict = entry.verdict;
  return fm;
};

/** Запись в log/ карточки: <время>-<тег>-<тип>.md (карточка известна по каталогу). Возвращает имя файла. */
export function addLog(card: Card, entry: LogInput): string {
  assertAlive(card);
  const text = requireText(entry.text, 'entry text');
  const dir = join(card.dir, 'log');
  ensureDir(dir);
  const token = stamp({
    dir,
    session: entry.session,
    kind: entry.type,
    now: entry.now,
    asOwner: entry.asOwner,
  });
  writeAtomic(join(dir, `${token}.md`), formatDoc(emptyDoc(), entryMeta({ ...entry, card: card.id }), text));
  return `${token}.md`;
}

/** Запись в log/ доски: <время>-<тег>-<id>-<тип>.md (карточка — в имени: лента читается через ls). */
export function addBoardLog(board: string, entry: LogInput & { card: string; asOwner?: boolean }): string {
  const text = requireText(entry.text, 'entry text');
  const dir = join(board, 'log');
  ensureDir(dir);
  const token = stamp({
    dir,
    session: entry.session,
    card: entry.card,
    kind: entry.type,
    now: entry.now,
    asOwner: entry.asOwner,
  });
  writeAtomic(join(dir, `${token}.md`), formatDoc(emptyDoc(), entryMeta(entry), text));
  return `${token}.md`;
}

const logged = (board: string, card: Card, entry: LogInput): Card => {
  addLog(card, entry);
  return readCard(board, card.column, card.name);
};

/** Ярлыки карточки: только правильные имена, без повторов; новое имя попадает в labels.yml (карточка 059). */
export function parseLabels(input: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of input ?? []) {
    const name = raw.trim().toLowerCase();
    if (!LABEL_RE.test(name)) {
      throw new Fail(`a label is lowercase Latin letters, digits, dots and hyphens; got «${raw}»`);
    }
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Новые имена — в известный список доски; повторно не добавляются. */
export function registerLabels(board: string, labels: readonly string[]): void {
  const known = readLabels(board);
  const fresh = labels.filter((name) => !known.includes(name));
  if (fresh.length > 0) writeLabels(board, [...known, ...fresh]);
}

/** Карточка 057 (UD-45): владелец ответил в ветке — карточка возвращается из blocked/ в todo/, замок снимается,
 *  в лог пишется запись answer. Ответ читает та сессия, что возьмёт карточку следующей. Не в blocked/ — ничего не делает. */
export function answerReceived(board: string, ref: string, threadDir: string, options: StepOptions = {}): Card | null {
  const card = oneCard(board, ref);
  if (card.column !== 'blocked') return null;
  for (const entry of readdirSync(card.dir)) {
    if ([LOCK, LEGACY_LOCK].some((prefix) => entry.startsWith(prefix))) {
      rmSync(join(card.dir, entry), { recursive: true, force: true });
    }
  }
  const moved = moveTo(board, readCard(board, card.column, card.name), 'todo');
  return logged(board, moved, {
    type: 'answer',
    session: OWNER,
    asOwner: true,
    now: options.now,
    text: `answer received: questions/${threadDir} — read answer.md (viboard show ${card.id})`,
  });
}

/** Заметка в log/ карточки. Возвращает имя файла. */
export interface StepOptions {
  /** Момент операции; по умолчанию — сейчас. */
  now?: Date;
  force?: boolean;
}

// --- шаги исполнителя ---

/** Заметка в log/ карточки. Возвращает имя файла. */
export function note(board: string, ref: string, session: string, text: string, options: StepOptions = {}): string {
  return addLog(oneCard(board, ref), { type: 'note', session, text, now: options.now });
}

/** Взятие карточки: lock-<тег> → запись → doing/. Занятую можно перехватить, если лок старше 24 ч или с --force. */
export function claim(board: string, ref: string, session: string, options: StepOptions = {}): Card {
  const tag = sessionTag(session);
  const now = options.now ?? new Date();
  let card = oneCard(board, ref);
  if (card.column === 'backlog') throw new Fail(`${card.name}: in backlog/ — only the owner moves it to todo/`);
  if (card.column === 'done') throw new Fail(`${card.name}: already in done/`);
  if (card.column === 'review') throw new Fail(`${card.name}: in review/ — waiting for a verdict`);
  if (card.lockedBy && card.lockedBy !== tag) {
    const stale = card.lockedAt !== null && now.getTime() - card.lockedAt > LOCK_STALE_MS;
    if (!options.force && !stale) {
      throw new Fail(`${card.name}: taken (lock-${card.lockedBy}); a lock older than 24h can be taken over — --force`);
    }
    const previous = card.lockedBy;
    card = unlockCard(board, card, previous);
    card = logged(board, card, {
      type: 'note',
      session: tag,
      text: `takeover: removed lock-${previous} (${stale ? 'older than 24h' : '--force'})`,
      now,
    });
  }
  const held = listCards(board).filter((c) => c.column === 'doing' && c.lockedBy === tag && c.id !== card.id);
  if (held.length >= WIP_LIMIT && !options.force) {
    throw new Fail(
      `WIP: session ${tag} already holds ${held.length} in doing/ (limit ${WIP_LIMIT}): ${held.map((c) => c.id).join(', ')}`,
    );
  }
  if (!card.lockedBy) {
    card = lockCard(card, tag);
    card = logged(board, card, { type: 'note', session: tag, text: `claim: session ${tag}`, now });
  }
  return moveTo(board, card, 'doing');
}

/** Вопрос владельцу: тред в questions/ + запись + blocked/. Лок держателя остаётся. */
export function ask(
  board: string,
  ref: string,
  session: string,
  text: string,
  options: StepOptions = {},
): { card: Card; thread: string } {
  const tag = sessionTag(session);
  const question = requireText(text, 'question');
  const now = options.now ?? new Date();
  const card = oneCard(board, ref);
  const qdir = join(board, 'questions');
  ensureDir(qdir);
  const token = stamp({ dir: qdir, session: tag, card: card.id, kind: 'q', now });
  ensureDir(join(qdir, token));
  writeAtomic(
    join(qdir, token, 'README.md'),
    formatDoc(emptyDoc(), { from: tag, card: card.id, created: token.slice(0, 18) }, question),
  );
  const firstLine = question.split('\n')[0] ?? question;
  const fresh = logged(board, card, {
    type: 'question',
    session: tag,
    text: `${firstLine} → questions/${token}/`,
    now,
  });
  // в blocked/ уходят только карточки, которые ждали работы; review/ и прочие остаются на месте
  const moved = fresh.column === 'doing' || fresh.column === 'todo' ? moveTo(board, fresh, 'blocked') : fresh;
  return { card: moved, thread: token };
}

export interface UnblockOptions {
  /** Кто развязывает; по умолчанию — владелец (UI). */
  session?: string;
  /** Куда; по умолчанию: с локом — doing/, без лока — todo/. */
  to?: string;
  now?: Date;
}

/** Развязка blocked/. */
export function unblock(board: string, ref: string, options: UnblockOptions = {}): Card {
  const tag = sessionTag(options.session ?? OWNER, { owner: true });
  let card = oneCard(board, ref);
  if (card.column !== 'blocked') throw new Fail(`${card.name}: not in blocked/ (currently ${card.column}/)`);
  card = moveTo(board, card, options.to ?? (card.lockedBy ? 'doing' : 'todo'));
  return logged(board, card, {
    type: 'note',
    session: tag,
    text: `unblocked: → ${card.column}/`,
    now: options.now,
    asOwner: tag === OWNER,
  });
}

function verdictRecord(
  board: string,
  card: Card,
  session: string,
  verdict: Verdict,
  text: string,
  options: StepOptions,
  asOwner: boolean,
): Card {
  return logged(board, card, { type: 'review', session, verdict, text, now: options.now, asOwner });
}

/** Готово к проверке: запись review/ready → review/, лок снят. */
export function readyForReview(
  board: string,
  ref: string,
  session: string,
  text: string,
  options: StepOptions = {},
): Card {
  const tag = sessionTag(session);
  const summary = requireText(text, 'what was done and how it was verified');
  let card = oneCard(board, ref);
  if (card.column === 'review' || card.column === 'done') throw new Fail(`${card.name}: already in ${card.column}/`);
  if (card.lockedBy && card.lockedBy !== tag) {
    throw new Fail(
      `${card.name}: taken by another session (lock-${card.lockedBy}) — only the lock holder moves it to review/`,
    );
  }
  card = verdictRecord(board, card, tag, 'ready', summary, options, false);
  if (card.lockedBy) card = unlockCard(board, card, card.lockedBy);
  return moveTo(board, card, 'review');
}

/** Вердикт pass: запись → done/ + запись в log/ доски (инвариант done: карточка в done/ ⇒ запись есть). */
export function verdictPass(
  board: string,
  ref: string,
  session: string,
  text: string,
  options: StepOptions = {},
): Card {
  const tag = sessionTag(session);
  const asOwner = tag === OWNER;
  let card = oneCard(board, ref);
  if (card.column !== 'review') {
    throw new Fail(`${card.name}: verdict pass applies only to a card in review/ (currently ${card.column}/)`);
  }
  card = verdictRecord(board, card, tag, 'pass', text.trim() || 'verdict: pass', options, asOwner);
  addBoardLog(board, {
    type: 'done',
    session: tag,
    card: card.id,
    text: `review → done: verdict pass (${asOwner ? 'owner' : `session ${tag}`}). What was done is in the card log/.`,
    now: options.now,
    asOwner,
  });
  return moveTo(board, card, 'done');
}

/** Вердикт fail: находка → doing/ (без лока — возьмёт следующий исполнитель). */
export function verdictFail(
  board: string,
  ref: string,
  session: string,
  text: string,
  options: StepOptions = {},
): Card {
  const tag = sessionTag(session);
  const finding = requireText(text, 'finding');
  let card = oneCard(board, ref);
  if (card.column !== 'review') {
    throw new Fail(`${card.name}: verdict fail applies only to a card in review/ (currently ${card.column}/)`);
  }
  card = verdictRecord(board, card, tag, 'fail', finding, options, false);
  return moveTo(board, card, 'doing');
}

// --- вложения ---

/** Имя файла вложения: без пути, без служебных и запрещённых в ОС символов, не длиннее 120. */
const FORBIDDEN = new Set('<>:"/\\|?*'.split(''));

export function safeFilename(name: string): string {
  const base = name.split(/[/\\]/u).pop() ?? '';
  let s = Array.from(base.normalize('NFC'), (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f || FORBIDDEN.has(ch) ? '_' : ch;
  })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[. ]+$/u, '');
  if (s === '' || s === '.' || s === '..') throw new Fail('invalid file name');
  if (/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/iu.test(s)) s = `_${s}`;
  if (s.length > 120) {
    const ext = extname(s);
    s = s.slice(0, 120 - ext.length) + ext;
  }
  return s;
}

export const ATTACH_LIMIT = 20 * 1048576; // 20 МБ

/** Сохранить вложение в каталог (assets/ карточки или тред). Возвращает имя файла. */
export function saveAsset(dir: string, filename: string, data: Buffer): string {
  const safe = safeFilename(filename);
  if (data.length === 0) throw new Fail('empty file');
  if (data.length > ATTACH_LIMIT) throw new Fail('file is larger than 20 MB');
  ensureDir(dir);
  const dst = join(dir, safe);
  if (statSync(dst, { throwIfNoEntry: false })) throw new Fail(`file «${safe}» is already attached`);
  writeAtomic(dst, data);
  return safe;
}
