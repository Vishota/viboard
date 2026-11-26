// Детерминистика имён (аксиома А4 протокола): время, тег сессии, id карточек, имена записей и тредов.
// Единственное место, где рождаются имена файлов доски — агенты не набирают их руками.

import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';

export const APP = 'viboard';
export type { Verdict } from './types.js';

export const LOG_KINDS = ['note', 'decision', 'question', 'blocked', 'answer', 'review', 'done'] as const;
export const THREAD_KINDS = ['q', 'msg', 'att'] as const;
export type LogKind = (typeof LOG_KINDS)[number];
export type ThreadKind = (typeof THREAD_KINDS)[number];
export type Kind = LogKind | ThreadKind;
export const KINDS: readonly Kind[] = [...LOG_KINDS, ...THREAD_KINDS];

/** Ярлыки (карточка 059, UD-46): живут во frontmatter карточки (`labels: [...]`), известный список — labels.yml.
 *  Ярлык agent — карточка, созданная агентом; без него — карточка владельца. */
export const LABELS_FILE = 'labels.yml';
export const AGENT_LABEL = 'agent';
/** Первая строка текста карточек, созданных агентами до ярлыков: по ней `viboard fix` ставит ярлык agent. */
export const AGENT_BODY_MARK = '**Автор карточки — агент**';

/** Настройки синхронизации с git (карточка 049): на устройстве, в gitignore доски. */
export const SYNC_SETTINGS = 'sync.json';

/** Тег владельца: всё, что написано через UI. Агентам недоступен. */
export const OWNER = 'owner';
/** Так подписывался UI до переименования (старые сообщения и вложения в тредах). */
export const LEGACY_OWNER = 'ui-owner';
/** lock-<тег> — папка в карточке; её наличие = «занято». Имя видимое: `ls` показывает его без -a. */
export const LOCK = 'lock-';
export const LEGACY_LOCK = '.lock-';
export const LOCK_STALE_MS = 24 * 3600e3;
export const WIP_LIMIT = 2;

const P = {
  stamp: '\\d{4}-\\d{2}-\\d{2}T\\d{6}Z',
  tag: '[a-z0-9][a-z0-9-]{1,11}',
  num: '\\d{3,}',
  slug: '[a-z0-9]+(?:-[a-z0-9]+)*',
  project: '[a-z0-9][a-z0-9._-]{0,31}',
};
const ID = `${P.num}-${P.slug}`;
const LOG = LOG_KINDS.join('|');

// <проект>-<NNN>-<слаг>: приоритет живёт только в карточке, не в имени (UD-40). Проект жадный, id закреплён
// за концом строки — имя разбирается однозначно, пока id проекта не кончается на `-<цифры>-<слаг>`.
export const CARD_NAME_RE = new RegExp(`^(${P.project})-(${ID})$`);
/** Прежний формат <проект>-P<1..5>-<NNN>-<слаг>: читается, переводится в новый через `viboard fix`. */
export const LEGACY_CARD_NAME_RE = new RegExp(`^(${P.project})-P([1-5])-(${ID})$`);
export const ID_RE = new RegExp(`^${ID}$`);
/** Ярлык — как id проекта: lowercase латиница, цифры, точки, дефисы (`bug`, `v0.2.0`). */
export const LABEL_RE = new RegExp(`^${P.project}$`);
export const SLUG_RE = new RegExp(`^${P.slug}$`);
export const PROJECT_RE = new RegExp(`^${P.project}$`);
export const MSG_RE = new RegExp(`^(${P.stamp})-(${P.tag})-msg\\.md$`);
export const ATT_RE = new RegExp(`^(${P.stamp})-(${P.tag})-att-(.+)$`);
/** Запись в log/ карточки: <время>-<тег>-<тип>.md (карточка известна по каталогу). */
export const CARD_ENTRY_RE = new RegExp(`^(${P.stamp})-(${P.tag})-(${LOG})\\.md$`);
/** Запись в log/ доски: <время>-<тег>-<id>-<тип>.md (карточка — в имени: лента читается через ls). */
export const BOARD_ENTRY_RE = new RegExp(`^(${P.stamp})-(${P.tag})-(${ID})-(${LOG})\\.md$`);

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  є: 'ye',
  і: 'i',
  ї: 'yi',
  ґ: 'g',
};

const p2 = (n: number): string => String(n).padStart(2, '0');

/** UTC-секунда вида 2026-11-23T183001Z — префикс всех имён записей (лексическая сортировка = хронология). */
export const utcStamp = (d: Date = new Date()): string =>
  `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}` +
  `T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;

export const stampDate = (s: string): Date =>
  new Date(`${s.slice(0, 10)}T${s.slice(11, 13)}:${s.slice(13, 15)}:${s.slice(15, 17)}Z`);

const readdirSafe = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/**
 * Тег сессии — идентичность агента в именах (2–12 символов [a-z0-9-]).
 * Длинные id среды сжимаются детерминированно: `sess_<uuid>` (ZCode) → первый блок uuid; прочее → первые 8 [a-z0-9].
 */
export function sessionTag(input: string | undefined, options: { owner?: boolean } = {}): string {
  if (!input || input.trim() === '') {
    throw new Error('a session tag is required: --session <tag>; new tag — viboard session');
  }
  const s = input.trim().toLowerCase();
  const zcode = /^sess[_-]?([0-9a-f]{8})/.exec(s);
  const tag = zcode?.[1] ?? s.replace(/[^a-z0-9]/g, '').slice(0, 8);
  if (!new RegExp(`^${P.tag}$`).test(tag)) throw new Error(`cannot derive a session tag from «${input}» (${P.tag})`);
  if (tag === OWNER && !options.owner) throw new Error(`tag «${OWNER}» is reserved for the owner (UI)`);
  return tag;
}

/** Новый случайный тег: 8 hex-символов. */
export const newSessionTag = (): string => randomBytes(4).toString('hex');

/** Тег для показа: сжимает длинные id среды, распознаёт старую подпись UI; что не сжалось — 12 символов. */
export function displayTag(s: string): string {
  const t = s.trim().toLowerCase();
  if (t === LEGACY_OWNER) return OWNER;
  try {
    return sessionTag(t, { owner: true });
  } catch {
    return t
      .replace(/[^a-z0-9-]/gu, ' ')
      .trim()
      .replace(/\s+/gu, '-')
      .slice(0, 12);
  }
}

/** Короткое имя карточки из названия: латиница, до `max` символов, по границе слова. */
export function slugify(text: string, max = 32): string {
  const words = text
    .toLowerCase()
    .split('')
    .map((c) => TRANSLIT[c] ?? c)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  let out = '';
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > max) {
      if (!out) out = w.slice(0, max);
      break;
    }
    out = next;
  }
  return out || 'task';
}

/** id проекта: как слаг, но точки сохраняются (vishota.com). */
export function projectId(name: string, max = 32): string {
  const s = name
    .toLowerCase()
    .split('')
    .map((c) => TRANSLIT[c] ?? c)
    .join('')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[.-]+|[.-]+$/gu, '')
    .slice(0, max);
  return s || 'project';
}

/** <NNN>-<слаг> новой карточки: NNN = max по всем id + 1 (padding до 3). */
export function nextId(ids: Iterable<string>, slug: string): string {
  if (!SLUG_RE.test(slug)) throw new Error(`a slug is lowercase Latin letters, digits and hyphens; got «${slug}»`);
  let max = 0;
  for (const id of ids) max = Math.max(max, parseInt(id, 10) || 0);
  return `${String(max + 1).padStart(3, '0')}-${slug}`;
}

export const cardName = (project: string, id: string): string => `${project}-${id}`;

export function parseCardName(name: string): { project: string; id: string } | null {
  const m = CARD_NAME_RE.exec(name);
  return m?.[1] && m[2] ? { project: m[1], id: m[2] } : null;
}

export function parseLegacyCardName(name: string): { project: string; priority: number; id: string } | null {
  const m = LEGACY_CARD_NAME_RE.exec(name);
  return m?.[1] && m[2] && m[3] ? { project: m[1], priority: Number(m[2]), id: m[3] } : null;
}

/** Тег из lock-<тег> (или устаревшего .lock-<тег>); не лок → null. */
export function lockTag(name: string): string | null {
  for (const prefix of [LOCK, LEGACY_LOCK]) {
    if (name.startsWith(prefix)) return name.slice(prefix.length) || null;
  }
  return null;
}

export interface StampInput {
  dir: string;
  session: string;
  /** id карточки; пусто — запись не о карточке. */
  card?: string;
  kind: Kind;
  now?: Date;
  /** Только для UI — «руки владельца»: писать от тега owner. */
  asOwner?: boolean;
  /** Секунда уже занята записью с тем же временем, которой нет среди файлов каталога (answer.md). */
  occupied?: (utc: string) => boolean;
}

/**
 * Токен имени записи: <время>-<тег>-[<id>-]<тип>. Файл записи = токен + .md; каталог треда = токен (тип q);
 * вложение треда = токен + -<имя файла> (тип att). Коллизия — следующая свободная секунда.
 * Сообщения и вложения треда (msg, att) одной сессии не делят секунду: порядок имён = порядок создания.
 */
export function stamp({
  dir,
  session,
  card = '',
  kind,
  now = new Date(),
  asOwner = false,
  occupied,
}: StampInput): string {
  const tag = sessionTag(session, { owner: asOwner });
  if (!KINDS.includes(kind)) throw new Error(`unknown kind «${kind}»; expected one of: ${KINDS.join(', ')}`);
  if (card && !ID_RE.test(card)) throw new Error(`card id must look like NNN-slug; got «${card}»`);
  const taken = readdirSafe(dir);
  const chat = kind === 'msg' || kind === 'att';
  const d = new Date(now.getTime());
  for (let i = 0; i < 3600; i++, d.setUTCSeconds(d.getUTCSeconds() + 1)) {
    const head = `${utcStamp(d)}-${tag}`;
    const token = card ? `${head}-${card}-${kind}` : `${head}-${kind}`;
    const clash =
      taken.some((f) => f === token || f === `${token}.md` || (kind === 'att' && f.startsWith(`${token}-`))) ||
      (chat && taken.some((f) => f.startsWith(`${head}-`))) ||
      (occupied?.(utcStamp(d)) ?? false);
    if (!clash) return token;
  }
  throw new Error(`no free second in «${dir}» — check the entries`);
}

export interface EntryName {
  time: string;
  tag: string;
  kind: LogKind;
  /** id карточки; пусто для записи из log/ карточки. */
  card: string;
}

/** Разбор имени записи лога либо null — имя вне формата. */
export function parseEntryName(file: string): EntryName | null {
  const card = CARD_ENTRY_RE.exec(file);
  if (card?.[1] && card[2] && card[3]) return { time: card[1], tag: card[2], card: '', kind: card[3] as LogKind };
  const board = BOARD_ENTRY_RE.exec(file);
  if (!board?.[1] || !board[2] || !board[3] || !board[4]) return null;
  return { time: board[1], tag: board[2], card: board[3], kind: board[4] as LogKind };
}
