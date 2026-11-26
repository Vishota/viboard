// JSON-API доски: проекция файловой системы для UI. Без состояния — каждый ответ читается с диска (А1).
// Все действия — «рука владельца»: сервер лишь передаёт то, что ввёл владелец в UI.

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { listCards, oneCard, readColumns, readEntries, readLabels, readProjects, summaryOf } from '../core/board.js';
import { parseDoc } from '../core/frontmatter.js';
import { installedProtocolVersion } from '../core/check.js';
import { Fail } from '../core/errors.js';
import { isRealFile, listFiles, readText } from '../core/fs.js';
import { ATT_RE } from '../core/names.js';
import {
  addColumn,
  addProject,
  answerReceived,
  createCard,
  deleteCard,
  deleteColumn,
  editCard,
  moveCard,
  saveAsset,
} from '../core/ops.js';
import { promptSet, prompts, type PromptContext } from '../core/prompts.js';
import { listThreads, postOwnerMessage, threadPath } from '../core/threads.js';
import type { BoardState, Card, CardDetail, Project } from '../core/types.js';
import { boardInfoAt, moveBoard, setDefaultBoard } from '../core/home.js';
import { toPosix } from '../core/paths.js';
import { clearRun, readRun, writeRun } from '../core/run.js';
import { setRemote, syncInfo, syncInfoCached, syncNow, writeSyncSettings } from '../core/sync.js';

export interface ApiContext {
  /** Папка доски; меняется после переноса через интерфейс. */
  board: string;
  version: string;
  promptContext: PromptContext;
}

type Body = Record<string, unknown>;

const str = (body: Body, key: string): string => {
  const v = body[key];
  return typeof v === 'string' ? v : '';
};

const flag = (body: Body, key: string): boolean => body[key] === true;

/** Число из JSON: число как есть, непустая строка — через Number, остальное — undefined. */
const num = (body: Body, key: string): number | undefined => {
  const v = body[key];
  if (typeof v === 'number') return v;
  return typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined;
};

/** Ярлыки из запроса: массив строк (карточка 059); иначе — пустой список. */
const labelsOf = (body: Body): string[] =>
  Array.isArray(body.labels) ? body.labels.filter((x): x is string => typeof x === 'string') : [];

const sizeOf = (file: string): number => {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
};

/** Только текст — без frontmatter: иначе «priority» или «created» находят все карточки доски (карточка 044). */
function matchCard(card: Card, q: string): boolean {
  if (card.title.toLowerCase().includes(q)) return true;
  const readme = readText(join(card.dir, 'README.md'));
  if (readme !== null && parseDoc(readme).body.toLowerCase().includes(q)) return true;
  return readEntries(card).some((entry) => entry.text.toLowerCase().includes(q));
}

function knownProject(ctx: ApiContext, id: string): string {
  const project: Project | undefined = readProjects(ctx.board).find((p) => p.id === id);
  if (!project) throw new Fail(`project «${id}» is not in projects.yml`);
  return id;
}

export async function buildState(ctx: ApiContext): Promise<BoardState> {
  const { board } = ctx;
  return {
    root: board,
    version: ctx.version,
    board: boardInfoAt(board),
    columns: readColumns(board),
    cards: listCards(board).map(summaryOf),
    projects: readProjects(board),
    questions: listThreads(board),
    prompts: promptSet(ctx.promptContext),
    labels: readLabels(board),
    protocol: { installed: installedProtocolVersion(board), current: ctx.version },
    sync: await syncInfoCached(board),
  };
}

export function cardDetail(ctx: ApiContext, ref: string): CardDetail {
  const card = oneCard(ctx.board, ref);
  const assetSizes = Object.fromEntries(card.assets.map((name) => [name, sizeOf(join(card.dir, 'assets', name))]));
  return { card, entries: readEntries(card), assetSizes };
}

/** Обрабатывает JSON-маршрут; null — маршрут не найден. */
export async function handleJson(
  ctx: ApiContext,
  method: string,
  pathname: string,
  query: URLSearchParams,
  body: Body,
): Promise<object | null> {
  const { board } = ctx;
  if (method === 'GET' && pathname === '/api/state') return buildState(ctx);
  if (method === 'GET' && pathname === '/api/card') return cardDetail(ctx, query.get('name') ?? query.get('id') ?? '');
  if (method === 'GET' && pathname === '/api/search') {
    // поиск по тексту постановки и названиям записей лога (карточка 044)
    const q = (query.get('q') ?? '').trim().toLowerCase();
    const names =
      q === ''
        ? []
        : listCards(board)
            .filter((c) => matchCard(c, q))
            .map((c) => c.name);
    return { names };
  }
  if (method === 'GET' && pathname === '/api/sync') return syncInfo(board);
  if (method === 'POST' && pathname === '/api/sync') {
    // карточка 049: подключение удалённого репозитория, настройки устройства, синхронизация руками
    const settings = writeSyncSettings(board, {
      ...(typeof body.autoPull === 'boolean' ? { autoPull: body.autoPull } : {}),
      ...(typeof body.autoPush === 'boolean' ? { autoPush: body.autoPush } : {}),
    });
    if (typeof body.remote === 'string') return setRemote(board, body.remote.trim());
    return body.action === 'settings' ? syncInfo(board) : syncNow(board, { pull: settings.autoPull });
  }
  if (method === 'GET' && pathname === '/api/board') return { ...boardInfoAt(ctx.board), path: toPosix(ctx.board) };
  if (method === 'POST' && pathname === '/api/board/default') {
    return setDefaultBoard(ctx.board);
  }
  if (method === 'POST' && pathname === '/api/board/migrate') {
    const result = moveBoard(ctx.board, str(body, 'path'), { force: flag(body, 'force') });
    const run = readRun(ctx.board);
    if (run && run.pid === process.pid) {
      writeRun(result.to, { ...run, board: result.to });
      clearRun(ctx.board);
    }
    ctx.board = result.to;
    ctx.promptContext.board = result.to;
    return result;
  }
  if (method === 'GET' && pathname === '/api/prompt') {
    // тот же источник, что `viboard prompt`: кнопка «Copy for agent»
    const asked = query.get('role') ?? 'executor';
    if (asked !== 'executor' && asked !== 'reviewer' && asked !== 'manager') {
      throw new Fail(`role must be executor, reviewer or manager; got «${asked}»`);
    }
    const role: keyof typeof prompts = asked;
    const ref = query.get('name') ?? query.get('id');
    return { prompt: prompts[role](ctx.promptContext, ref ? oneCard(ctx.board, ref) : null, '<tag>') };
  }

  if (method !== 'POST') return null;
  switch (pathname) {
    case '/api/card': {
      const card = createCard(board, {
        project: knownProject(ctx, str(body, 'project')),
        title: str(body, 'title'),
        body: str(body, 'body'),
        priority: num(body, 'priority'),
        column: str(body, 'column') || undefined,
        labels: labelsOf(body),
      });
      return { card: summaryOf(card) };
    }
    case '/api/card/edit': {
      const card = editCard(board, str(body, 'name') || str(body, 'id'), {
        title: str(body, 'title') || undefined,
        body: typeof body.body === 'string' ? body.body : undefined,
        project: str(body, 'project') || undefined,
        priority: num(body, 'priority'),
        ...(body.labels === undefined ? {} : { labels: labelsOf(body) }),
      });
      return { card: summaryOf(card) };
    }
    case '/api/card/move': {
      const card = moveCard(board, str(body, 'name') || str(body, 'id'), str(body, 'to'), {
        force: flag(body, 'force'),
      });
      return { card: summaryOf(card) };
    }
    case '/api/card/delete':
      return { column: deleteCard(board, str(body, 'name') || str(body, 'id')) };
    case '/api/columns': {
      const name = str(body, 'name');
      return body.action === 'delete' ? { deleted: deleteColumn(board, name) } : { added: addColumn(board, name) };
    }
    case '/api/project':
      return {
        project: addProject(board, {
          id: str(body, 'id') || undefined,
          name: str(body, 'name'),
          path: str(body, 'path'),
        }),
      };
    case '/api/chat': {
      const dir = str(body, 'q');
      const file = postOwnerMessage(board, dir, str(body, 'text'));
      // карточка 057 (UD-45): ответ по карточке в blocked/ возвращает её в todo/ с записью answer
      const thread = listThreads(board).find((item) => item.dir === dir);
      if (thread && thread.card !== '') answerReceived(board, thread.card, dir);
      return { file };
    }
    default:
      return null;
  }
}

/** Вложение в карточку — в assets/; возвращает имя файла. */
export function attachToCard(ctx: ApiContext, ref: string, filename: string, data: Buffer): string {
  const card = oneCard(ctx.board, ref);
  return saveAsset(join(card.dir, 'assets'), filename, data);
}

/** Вложение карточки: только имя из фактического списка assets/ — путь собрать нельзя. */
export function cardAssetPath(ctx: ApiContext, ref: string, name: string | null): string {
  const card = oneCard(ctx.board, ref);
  if (!name || !card.assets.includes(name)) throw new Fail('file not found');
  const file = join(card.dir, 'assets', name);
  if (!isRealFile(file)) throw new Fail('file not found');
  return file;
}

/** Вложение треда: только существующий файл вида <время>-<тег>-att-<имя> в этом треде. */
export function threadAssetPath(ctx: ApiContext, dir: string, name: string | null): string {
  const thread = threadPath(ctx.board, dir);
  if (!name || !ATT_RE.test(name) || !listFiles(thread).includes(name)) throw new Fail('file not found');
  return join(thread, name);
}
