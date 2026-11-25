// Карточка 049: git как машина состояний доски. Доска — репозиторий; устройства синхронизируются через
// commit + push и pull. KISS: конфликт не разрешается автоматически — rebase прерывается (локальная доска
// остаётся целой), а владелец просит агента разрешить конфликт.

import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { readText, writeAtomic } from './fs.js';
import { SYNC_SETTINGS, utcStamp } from './names.js';
import type { SyncInfo, SyncSettings } from './types.js';

export const CONFLICT_HINT =
  'The same files changed on two devices. Nothing is lost: this device keeps its changes; they are not sent until the conflict is resolved.';
export const REMOTE_RE = /^(https?:\/\/|ssh:\/\/|git@)[\w@.:~/-]+$/;

/** Настройки синхронизации живут на устройстве (sync.json исключён из git), а не в репозитории. */
export function readSyncSettings(board: string): SyncSettings {
  const raw = readText(join(board, SYNC_SETTINGS));
  if (raw === null) return { autoPull: true, autoPush: true };
  const json = JSON.parse(raw) as Partial<SyncSettings>;
  return { autoPull: json.autoPull !== false, autoPush: json.autoPush !== false };
}

export function writeSyncSettings(board: string, settings: Partial<SyncSettings>): SyncSettings {
  const next = { ...readSyncSettings(board), ...settings };
  writeAtomic(join(board, SYNC_SETTINGS), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** Последняя содержательная строка stderr: её видит владелец. */
const brief = (text: string): string => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^(hint:|warning:)/i.test(line));
  return lines.at(-1) ?? '';
};

function git(board: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      // личность не настроена — коммит всё равно проходит от имени доски
      ['-c', 'user.name=viboard', '-c', 'user.email=viboard@localhost', ...args],
      {
        cwd: board,
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout, stderr) => (error === null ? resolve(stdout) : reject(new Error(brief(stderr) || error.message))),
    );
  });
}

/** Команда, которая может законно ничего не вернуть (нет origin, нет upstream). */
async function optional(board: string, args: string[]): Promise<string> {
  try {
    return (await git(board, args)).trim();
  } catch {
    return '';
  }
}

const samePath = (a: string, b: string): boolean => {
  const x = resolve(a);
  const y = resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/** Корень репозитория, в котором лежит доска; null — git нет или папка вне репозитория. */
async function repoTop(board: string): Promise<string | null> {
  const top = await optional(board, ['rev-parse', '--show-toplevel']);
  return top === '' ? null : top;
}

/** Конфликт и последняя ошибка известны только попыткам синхронизации — они их и держат по доске. */
const conflict = new Set<string>();
const lastError = new Map<string, string>();
const running = new Map<string, Promise<SyncInfo>>();

/** Текущее состояние: только локальный git, без сети. */
export async function syncInfo(board: string): Promise<SyncInfo> {
  const settings = readSyncSettings(board);
  const top = await repoTop(board);
  // внутри чужого репозитория синхронизацию не трогаем: коммит и pull задели бы чужую работу
  if (top === null || !samePath(top, board)) {
    return {
      available: false,
      reason: top === null ? 'no-git' : 'inside-repo',
      remote: '',
      branch: '',
      ...settings,
      state: 'off',
      pending: 0,
      message: '',
    };
  }
  const dirty = (await optional(board, ['status', '--porcelain'])) !== '';
  const ahead = Number(await optional(board, ['rev-list', '--count', '@{u}..HEAD'])) || 0;
  const error = lastError.get(board) ?? '';
  return {
    available: true,
    reason: null,
    remote: await optional(board, ['remote', 'get-url', 'origin']),
    branch: await optional(board, ['rev-parse', '--abbrev-ref', 'HEAD']),
    ...settings,
    state: conflict.has(board) ? 'conflict' : error !== '' ? 'error' : dirty || ahead > 0 ? 'dirty' : 'clean',
    pending: Number(dirty) + ahead,
    message: conflict.has(board) ? CONFLICT_HINT : error,
  };
}

/** Кэш на 2 секунды: опрос интерфейса каждые 2,5 с не должен запускать git. */
const cache = new Map<string, { info: SyncInfo; at: number }>();

export async function syncInfoCached(board: string): Promise<SyncInfo> {
  const hit = cache.get(board);
  if (hit && Date.now() - hit.at < 2000) return hit.info;
  const info = await syncInfo(board);
  cache.set(board, { info, at: Date.now() });
  return info;
}

async function commitAll(board: string): Promise<void> {
  if ((await git(board, ['status', '--porcelain'])).trim() === '') return;
  await git(board, ['add', '-A', '--', '.']);
  // `commit -- .` — только папка доски
  await git(board, ['commit', '-q', '-m', `viboard ${utcStamp()}`, '--', '.']);
}

const CONFLICT_RE = /^(UU|AA|DD|AU|UA|DU|UD) /mu;

type PullResult = { kind: 'ok' | 'conflict' | 'error'; message: string };

/** Без upstream (ещё не отправляли) тянуть нечего — 'ok'. */
async function pull(board: string): Promise<PullResult> {
  const done: PullResult = { kind: 'ok', message: '' };
  if ((await optional(board, ['rev-parse', '--abbrev-ref', '@{u}'])) === '') return done;
  try {
    await git(board, ['pull', '--rebase', '--autostash']);
    return done;
  } catch (e) {
    const message = (e as Error).message;
    const conflicted = CONFLICT_RE.test(await optional(board, ['status', '--porcelain']));
    await optional(board, ['rebase', '--abort']);
    return { kind: conflicted ? 'conflict' : 'error', message };
  }
}

async function push(board: string): Promise<void> {
  if ((await optional(board, ['remote', 'get-url', 'origin'])) === '')
    throw new Error('connect a remote repository first');
  const first = (await optional(board, ['rev-parse', '--abbrev-ref', '@{u}'])) === '';
  await git(board, first ? ['push', '-u', 'origin', 'HEAD'] : ['push']);
}

/** Подключить удалённый репозиторий. Адрес вводит владелец и уходит в git аргументом, не через оболочку. */
export async function setRemote(board: string, url: string): Promise<SyncInfo> {
  if (!REMOTE_RE.test(url)) throw new Error('remote must look like https://…, git@… or ssh://…');
  const exists = (await optional(board, ['remote', 'get-url', 'origin'])) !== '';
  await git(board, exists ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url]);
  lastError.delete(board);
  return syncInfo(board);
}

export interface SyncOptions {
  /** Закоммитить локальные изменения (нужно перед push). */
  commit?: boolean;
  pull?: boolean;
  push?: boolean;
}

/** Одна попытка: коммит → pull → push. Пока идёт, вторая для той же доски возвращает ту же работу. */
export function syncNow(
  board: string,
  options: SyncOptions = { commit: true, pull: true, push: true },
): Promise<SyncInfo> {
  const active = running.get(board);
  if (active) return active;
  const run = (async (): Promise<SyncInfo> => {
    conflict.delete(board);
    lastError.delete(board);
    try {
      if (options.commit) await commitAll(board);
      const pulled = options.pull === false ? { kind: 'ok' as const, message: '' } : await pull(board);
      if (pulled.kind === 'conflict') conflict.add(board);
      else if (pulled.kind === 'error') lastError.set(board, pulled.message);
      else if (options.push) await push(board);
    } catch (e) {
      lastError.set(board, (e as Error).message);
    } finally {
      running.delete(board);
      cache.delete(board);
    }
    return syncInfo(board);
  })();
  running.set(board, run);
  return run;
}

/**
 * Автоматическая попытка по таймеру: делает только включённое. Конфликт сама не повторяет — его
 * разрешают снаружи и жмут кнопку; ошибку сети пробует снова на следующем такте.
 */
export async function syncAuto(board: string): Promise<SyncInfo | null> {
  const settings = readSyncSettings(board);
  const info = await syncInfo(board);
  if (!info.available || running.has(board) || conflict.has(board)) return null;
  const push = settings.autoPush && info.remote !== '';
  if (!push && !(settings.autoPull && info.branch !== '')) return null;
  return syncNow(board, { commit: push, pull: settings.autoPull, push });
}
