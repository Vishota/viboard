// Чтение доски: где она, какие колонки и проекты, какие карточки. Пишет — ops.ts.
// Доска — данные, не документация: всё здесь — проекция файловой системы (аксиома А1).

import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { unquote, metaInt, metaStr, parseDoc, type Doc } from './frontmatter.js';
import { isRealDir, isRealFile, listDirs, listFiles, mtimeMs, readText, writeAtomic } from './fs.js';
import { APP, ID_RE, LEGACY_LOCK, LOCK, cardName, parseCardName, parseEntryName, type Verdict } from './names.js';
import type { Card, CardSummary, LogEntry, Project } from './types.js';
import { Fail } from './errors.js';

export const DEFAULT_COLUMNS = ['backlog', 'todo', 'doing', 'blocked', 'review', 'done'];
/** Каталоги доски, которые не колонки. */
const NOT_COLUMNS = new Set(['questions', 'log', 'templates']);
export const COLUMN_RE = /^[a-z][a-z0-9-]{1,23}$/;
export const ENV_BOARD = `${APP}_BOARD`.toUpperCase();

export const defaultBoard = (): string => join(configDir(), 'board');
// $VIBOARD_HOME переносит настройки (config.json, run/) — нужно тестам и переносимой exe-версии.
export const configDir = (): string => process.env[`${APP}_HOME`.toUpperCase()] || join(homedir(), `.${APP}`);

export const isBoard = (path: string): boolean =>
  isRealFile(join(path, 'columns.yml')) || isRealDir(join(path, 'todo'));

export function readColumns(board: string): string[] {
  let listed: string[] = [];
  const yml = readText(join(board, 'columns.yml'));
  if (yml !== null) {
    listed = yml
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#') && COLUMN_RE.test(l));
  }
  const disk = listDirs(board).filter((n) => !NOT_COLUMNS.has(n) && COLUMN_RE.test(n));
  return [...new Set([...listed, ...disk])];
}

export function writeColumns(board: string, columns: string[]): void {
  const head =
    '# Board columns from left to right, one per line.\n# Names are directory names; the UI adds and removes empty ones.\n';
  writeAtomic(join(board, 'columns.yml'), `${head}${columns.join('\n')}\n`);
}

export function readProjects(board: string): Project[] {
  const text = readText(join(board, 'projects.yml'));
  if (text === null) return [];
  const out: Project[] = [];
  let cur: Project | null = null;
  for (const line of text.split(/\r?\n/)) {
    const top = /^([A-Za-z0-9._-]+):\s*$/.exec(line);
    if (top?.[1]) {
      cur = { id: top[1], name: top[1], path: '' };
      out.push(cur);
      continue;
    }
    const kv = /^\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (kv?.[1] && kv[2] !== undefined && cur) {
      if (kv[1] === 'name') cur.name = unquote(kv[2]) || cur.id;
      else if (kv[1] === 'path') cur.path = unquote(kv[2]);
    }
  }
  return out;
}

export function writeProjects(board: string, projects: Project[]): void {
  const head = '# Board projects: id → name, path. path is the directory where an agent works on the project cards.\n';
  const body = projects
    .map((p) => `${p.id}:\n  name: ${JSON.stringify(p.name)}\n  path: ${JSON.stringify(p.path)}\n`)
    .join('\n');
  writeAtomic(join(board, 'projects.yml'), `${head}\n${body}`);
}

export function readCard(board: string, column: string, name: string): Card {
  const dir = join(board, column, name);
  const doc = parseDoc(readText(join(dir, 'README.md')) ?? '');
  const parts = parseCardName(name);
  const fmId = metaStr(doc, 'id');
  const id = ID_RE.test(fmId) ? fmId : (parts?.id ?? name);
  let lockedBy: string | null = null;
  let lockedAt: number | null = null;
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const tag = [LOCK, LEGACY_LOCK].find((p) => e.name.startsWith(p));
      if (tag && e.name.length > tag.length) {
        lockedBy = e.name.slice(tag.length);
        lockedAt = mtimeMs(join(dir, e.name));
        break;
      }
    }
  } catch {
    /* каталога нет — пустые списки */
  }
  return {
    board,
    column,
    dir,
    name,
    id,
    slug: id.replace(/^\d+-/u, ''),
    project: metaStr(doc, 'project', parts?.project ?? ''),
    priority: metaInt(doc, 'priority', parts?.priority ?? 3),
    title: metaStr(doc, 'title'),
    meta: Object.fromEntries(doc.fields.map((f) => [f.key, f.value])),
    body: doc.body,
    lockedBy,
    lockedAt,
    log: listFiles(join(dir, 'log')).filter((f) => f.endsWith('.md')),
    assets: listFiles(join(dir, 'assets')),
  };
}

const isCardLike = (name: string): boolean => parseCardName(name) !== null || /^\d{3,}-/u.test(name);

/** Каталоги-«призраки»: выглядят как карточки, но без README — остаток старого пути после переименования. */
export function listGhosts(board: string): { column: string; name: string; dir: string; id: string }[] {
  const out: { column: string; name: string; dir: string; id: string }[] = [];
  for (const column of readColumns(board)) {
    for (const name of listDirs(join(board, column))) {
      const dir = join(board, column, name);
      if (isCardLike(name) && !isRealFile(join(dir, 'README.md'))) {
        out.push({ column, name, dir, id: parseCardName(name)?.id ?? name });
      }
    }
  }
  return out;
}

/** Папку карточки могли переименовать (смена приоритета) или увести в другую колонку, пока держатель
 * держал старый путь. Запись по мёртвому пути пересоздала бы старую папку — и появились бы два каталога с одним id. */
export function assertAlive(card: Card): void {
  if (!isRealDir(card.dir)) {
    throw new Fail(
      `${card.id}: its folder was renamed or moved — find it again before writing: viboard find ${card.id}`,
    );
  }
}

/** Все карточки всех колонок; внутри колонки — по имени (проект → приоритет → id). */
export function listCards(board: string): Card[] {
  const out: Card[] = [];
  for (const column of readColumns(board)) {
    for (const name of listDirs(join(board, column))) {
      // новый формат <проект>-P<n>-<NNN>-<слаг> и старый <NNN>-<слаг>; каталог без README — не карточка (призрак)
      if (isCardLike(name) && isRealFile(join(board, column, name, 'README.md'))) {
        out.push(readCard(board, column, name));
      }
    }
  }
  return out;
}

/** Карточки по id, точному имени или фрагменту имени (путь карточки не кэшируется). */
export function findCards(board: string, ref: string): Card[] {
  const r = ref.trim();
  if (!r || /[/\\]/u.test(r)) throw new Fail('expected a card id or a name fragment — without a path');
  const all = listCards(board);
  // точное имя папки уникально всегда — оно побеждает id: два каталога с одним id не ломают обращение по имени
  const exactName = all.filter((c) => c.name === r);
  if (exactName.length > 0) return exactName;
  const exactId = all.filter((c) => c.id === r);
  if (exactId.length > 0) return exactId;
  return all.filter((c) => c.name.includes(r) || c.id.includes(r));
}

/** Ровно одна карточка — иначе ошибка с подсказкой, что уточнить. */
export function oneCard(board: string, ref: string): Card {
  const hits = findCards(board, ref);
  const first = hits[0];
  if (hits.length === 1 && first) return first;
  if (hits.length === 0) throw new Fail(`card not found: «${ref}» — viboard ls lists the board`);
  throw new Fail(
    `«${ref}» matches several cards — one id, several folders (viboard check lists them). Use the full folder name:\n  ${hits.map((c) => c.name).join('\n  ')}`,
  );
}

export const summaryOf = (c: Card): CardSummary => ({
  name: c.name,
  id: c.id,
  slug: c.slug,
  column: c.column,
  project: c.project,
  priority: c.priority,
  title: c.title,
  lockedBy: c.lockedBy,
  lockedAt: c.lockedAt,
  assets: c.assets.length,
  log: c.log.length,
});

export const readCardDoc = (card: Card): Doc => parseDoc(readText(join(card.dir, 'README.md')) ?? '');

/** Как должна назляться карточка по её frontmatter. */
export const expectedName = (card: Card): string => cardName(card.project, card.priority, card.id);

const VERDICTS: readonly Verdict[] = ['ready', 'pass', 'fail'];

/** Записи log/ карточки с текстом, по времени (имя файла). */
export function readEntries(card: Card): LogEntry[] {
  return card.log
    .map((file): LogEntry => {
      const name = parseEntryName(file);
      const doc = parseDoc(readText(join(card.dir, 'log', file)) ?? '');
      const verdict = metaStr(doc, 'verdict');
      return {
        file,
        time: name?.time ?? '',
        tag: name?.tag ?? metaStr(doc, 'session'),
        type: name?.kind ?? metaStr(doc, 'type'),
        card: card.id,
        verdict: VERDICTS.find((v) => v === verdict) ?? null,
        text: doc.body,
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}
