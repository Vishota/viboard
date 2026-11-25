import type { FieldValue } from './frontmatter.js';

/** Вердикт записи type: review — «готово к проверке» (исполнитель), pass/fail (проверяющий). */
export type Verdict = 'ready' | 'pass' | 'fail';

/** Тексты заданий для сессий; `board` — строка для «Connect an agent». */
export type Role = 'executor' | 'reviewer' | 'manager';
export type PromptName = Role | 'board';

/** Проект из projects.yml: id → имя и каталог, где агент работает по карточкам проекта. */
export interface Project {
  id: string;
  name: string;
  path: string;
}

/** Карточка = каталог в колонке; статус — имя колонки, занятость — наличие lock-<тег>. */
export interface Card {
  board: string;
  column: string;
  dir: string;
  /** Имя каталога: <проект>-P<приоритет>-<NNN>-<слаг>. */
  name: string;
  /** Стабильный id: <NNN>-<слаг> — на него ссылаются, его ищут. */
  id: string;
  slug: string;
  project: string;
  priority: number;
  title: string;
  meta: Record<string, FieldValue>;
  body: string;
  lockedBy: string | null;
  lockedAt: number | null;
  log: string[];
  assets: string[];
}

/** Карточка для списка (опрос UI): без тела и с счётчиками вместо листингов. */
export interface CardSummary {
  name: string;
  id: string;
  slug: string;
  column: string;
  project: string;
  priority: number;
  title: string;
  lockedBy: string | null;
  lockedAt: number | null;
  assets: number;
  log: number;
}

export interface CardInput {
  project: string;
  title: string;
  body: string;
  priority?: number;
  /** Колонка создания; по умолчанию todo (или первая). */
  column?: string;
  /** Короткое имя для каталога; по умолчанию — из названия. */
  slug?: string;
}

export interface CardPatch {
  title?: string;
  body?: string;
  project?: string;
  priority?: number;
}

export interface LogEntry {
  file: string;
  /** UTC-секунда из имени. */
  time: string;
  tag: string;
  type: string;
  card: string;
  verdict: Verdict | null;
  text: string;
}

export interface CardDetail {
  card: Card;
  entries: LogEntry[];
  assetSizes: Record<string, number>;
}

export type Side = 'agent' | 'user';

export interface Message {
  side: Side;
  session: string;
  /** ms; null — первое сообщение агента (время — в имени каталога треда). */
  time: number | null;
  body: string;
  /** Имя файла-вложения либо null. */
  attachment: string | null;
}

/** Тред чата = каталог в questions/: README агента, ответ владельца, сообщения, вложения. */
export interface Thread {
  dir: string;
  /** id карточки, к которой вопрос; '' — общий вопрос. */
  card: string;
  created: string;
  answered: boolean;
  lastFrom: Side;
  messages: Message[];
}

export type FindingLevel = 'error' | 'warn' | 'info';

export interface Finding {
  level: FindingLevel;
  text: string;
}

/** Синхронизация доски через git (карточка 049); логика — в sync.ts. */
export interface SyncSettings {
  autoPull: boolean;
  autoPush: boolean;
}

export type SyncState = 'off' | 'clean' | 'dirty' | 'conflict' | 'error';

export interface SyncInfo {
  /** git есть и доска — корень своего репозитория; иначе синхронизация невозможна. */
  available: boolean;
  /** Почему недоступно — показать владельцу. */
  reason: 'no-git' | 'inside-repo' | null;
  /** Адрес origin; пусто — доска ещё не подключена к удалённому репозиторию. */
  remote: string;
  branch: string;
  autoPull: boolean;
  autoPush: boolean;
  state: SyncState;
  /** Незакоммиченные изменения и неотправленные коммиты. */
  pending: number;
  /** Последняя ошибка или пояснение конфликта — показать владельцу. */
  message: string;
}

/** Всё, что UI нужно для отрисовки: проекция файловой системы, без собственного состояния. */
export interface BoardState {
  root: string;
  board: { path: string; source: string; defaultPath: string; isDefault: boolean; exists: boolean };
  version: string;
  columns: string[];
  cards: CardSummary[];
  projects: Project[];
  questions: Thread[];
  /** Синхронизация доски через git (карточка 049). */
  sync: SyncInfo;
  /** Тексты заданий для новых сессий (тот же источник, что `viboard prompt`). */
  prompts: Record<'executor' | 'reviewer' | 'manager' | 'board', string>;
  protocol: { installed: string | null; current: string };
}

// --- одна доска на устройство (карточка 047) ---

export interface Config {
  /** Папка доски по умолчанию; отсутствует — ~/.viboard/board. */
  board?: string;
}

export type BoardSource = 'flag' | 'env' | 'config' | 'default';

export interface BoardInfo {
  path: string;
  source: BoardSource;
  /** Папка, в которую приходит запуск без аргументов. */
  defaultPath: string;
  isDefault: boolean;
  exists: boolean;
}

export interface MoveResult {
  from: string;
  to: string;
  files: number;
  /** Файлы, которые не удалось удалить из старой папки (заняты процессами); копия в новой папке полная. */
  leftBehind: string[];
  /** Локи, снятые вместе со старой папкой при --force. */
  forcedLocks: string[];
  /** Сменился ли default: только когда переносили доску по умолчанию. */
  defaultChanged: boolean;
  /** Какая папка теперь default. */
  defaultPath: string;
}
