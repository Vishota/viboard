// Сервер доски: stateless-проекция файловой системы (А1), слушает только loopback.
// Локальный режим — без пароля, защищён проверкой Host (DNS rebinding) и Origin (CSRF);
// режим с паролем — вход по паролю, HttpOnly-cookie (обязателен, если доска открыта через туннель).

import { basename, extname, isAbsolute, join, relative } from 'node:path';
import { randomBytes } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { Fail } from '../core/errors.js';
import { isRealFile, readFileSyncSafe, readText } from '../core/fs.js';
import { APP } from '../core/names.js';
import { UI_DIR } from '../core/paths.js';
import { ATTACH_LIMIT } from '../core/ops.js';
import { postOwnerAttachment } from '../core/threads.js';
import { readRun, writeRun } from '../core/run.js';
import { syncAuto } from '../core/sync.js';
import { VERSION } from '../core/version.js';
import { attachToCard, cardAssetPath, handleJson, threadAssetPath, type ApiContext } from './api.js';
import { createAccessManager } from './access.js';
import type { AccessManager, TunnelSetup } from './access.js';
import { Auth } from './auth.js';
import {
  secretEquals,
  CSP_APP,
  CSP_SANDBOX,
  HttpError,
  RateLimiter,
  hostAllowed,
  listenWithFallback,
  originAllowed,
  readBody,
  respondError,
  securityHeaders,
  sendJson,
} from './http.js';

export { listenWithFallback } from './http.js';

export interface ServerOptions {
  board: string;
  port?: number;
  host?: string;
  /** Включает авторизацию: вход по паролю. */
  password?: string;
  /** Доска открыта наружу через туннель: cookie Secure и rate limit. Требует password. */
  publicAccess?: boolean;
  /** Дополнительные Origin, которым разрешена запись (dev-сервер Vite). */
  devOrigins?: string[];
  /** Токен управления: знает только процесс с записью «уже запущено» — по нему CLI переключает режим доступа. */
  onControl?: (token: string) => void;
  /** Где искать клиент туннеля и где хранить устройства (UD-55); по умолчанию — папка пакета и папка настроек. */
  tunnel?: TunnelSetup;
  uiDir?: string;
  /** Команда CLI, которую протокол рекомендует агентам в промптах. */
  cli?: string;
}

export interface Running {
  server: http.Server;
  url: string;
  port: number;
  control: string;
  close: () => Promise<void>;
}

const JSON_LIMIT = 1_048_576;
const UPLOAD_LIMIT = ATTACH_LIMIT + 1_048_576;
const POSTS_PER_MINUTE = 300;
const LOGINS_PER_5_MINUTES = 10;

const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Типы, которые показываются в странице (картинки); остальное — только скачивание. */
const INLINE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** Сервер доски с его обработчиком: удалённый слушатель доступа передаёт запросы ему (UD-55). */
export interface BoardServer extends http.Server {
  handle: (req: IncomingMessage, res: ServerResponse) => void;
  /** Управление удалённым доступом этого сервера. */
  access: AccessManager;
}

export function createBoardServer(options: ServerOptions): BoardServer {
  let publicAccess = options.publicAccess === true;
  if (publicAccess && !options.password) {
    throw new Fail('public access requires a password: --password <password> or the VIBOARD_PASSWORD variable');
  }
  let auth = options.password ? new Auth(options.password, publicAccess) : null;
  let limiter = publicAccess ? new RateLimiter() : null;
  const policy = { devOrigins: options.devOrigins ?? [], publicAccess };
  // карточка 141 (UD-47): один порт. Режим доступа переключает CLI командой viboard public / viboard local —
  // через токен управления из записи «уже запущено»; у страницы такого токена нет, её запросы идут через Origin.
  const control = randomBytes(24).toString('hex');
  options.onControl?.(control);

  /** Сменить режим доступа. Пароль нужен всегда: включить без пароля нельзя, выключить может лишь знающий пароль. */
  async function switchMode(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const given = req.headers.authorization ?? '';
    if (!secretEquals(given, `Control ${control}`)) throw new HttpError(403, 'not the controlling process');
    const body = await readJson(req);
    const next = body.public === true;
    const password = typeof body.password === 'string' ? body.password : '';
    if (password === '') throw new HttpError(400, 'a password is required');
    if (next && access.state().on) {
      throw new HttpError(409, 'remote access is open — close it first in the window "Remote access"');
    }
    if (next) {
      auth = new Auth(password, true);
      limiter = new RateLimiter();
    } else {
      auth?.login(password); // не зная пароля, публичный доступ не выключить
      const cleared = auth?.clearCookie();
      if (cleared !== undefined) res.setHeader('Set-Cookie', cleared);
      auth = null;
      limiter = null;
    }
    publicAccess = next;
    policy.publicAccess = next;
    const run = readRun(options.board);
    if (run && run.pid === process.pid) writeRun(options.board, { ...run, publicAccess: next });
    sendJson(res, 200, { public: next, port: port() });
  }
  const uiDir = options.uiDir ?? UI_DIR;
  const ctx: ApiContext = {
    board: options.board,
    version: VERSION,
    promptContext: { board: options.board, cli: options.cli ?? `npx ${APP}` },
  };

  const server = http.createServer((req, res) => {
    void handle(req, res);
  });

  // карточка 049: авто-синхронизация с git — коммит и push изменений (в том числе сделанных агентами через CLI),
  // pull с другого устройства. Пока интерфейс опрашивает доску (2,5 с), задержка сравнима с опросом.
  const SYNC_MS = 10_000;
  const syncTimer = setInterval(() => void syncAuto(ctx.board).catch(() => undefined), SYNC_MS);
  syncTimer.unref();

  const port = (): number => {
    const address = server.address();
    return address !== null && typeof address === 'object' ? address.port : (options.port ?? 0);
  };

  // Удалённый доступ (UD-55): туннель смотрит на внутренний слушатель, запросы с него приходят сюда как
  // от доверенного прокси. Управление доступом — только с локального, у туннеля туда пути нет.
  const access: AccessManager = createAccessManager({
    localPort: port,
    localHandle: (req, res) => void handle(req, res),
    passwordMode: () => publicAccess,
    ...options.tunnel,
  });
  server.on('close', () => void access.close());

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const type = String(req.headers['content-type'] ?? '');
    if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'expected application/json');
    const raw = await readBody(req, JSON_LIMIT);
    if (raw.length === 0) return {};
    let value: unknown;
    try {
      value = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new HttpError(400, 'invalid JSON');
    }
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    securityHeaders(res);
    res.setHeader('X-Powered-By', `${APP}/${VERSION}`);
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname;
      const query = url.searchParams;
      const method = req.method ?? 'GET';
      const ip = req.socket.remoteAddress ?? '?';

      const protectedByPassword = auth !== null;
      if (!hostAllowed(req.headers.host, port(), protectedByPassword)) {
        // без пароля имя должно быть ровно 127.0.0.1 — иначе туннель, переписывающий имя, прошёл бы за локального
        throw new HttpError(
          403,
          protectedByPassword
            ? 'request is not for this host'
            : `open the board at http://127.0.0.1:${port()}: other names are refused so that a tunnel cannot pass for a local browser`,
        );
      }

      if (method === 'GET') {
        if (path === '/') return serveIndex(res, uiDir);
        if (path.startsWith('/static/')) return serveStatic(res, uiDir, path);
        if (path === '/api/ping') return sendJson(res, 200, { app: APP, version: VERSION, pid: process.pid });
        if (path === '/api/asset') {
          return sendAttachment(res, cardAssetPath(ctx, query.get('card') ?? '', query.get('f')));
        }
        if (path === '/api/chat-asset') {
          return sendAttachment(res, threadAssetPath(ctx, query.get('q') ?? '', query.get('f')));
        }
        if (auth && !auth.valid(req)) throwUnauthorized();
        if (path.startsWith('/api/access')) {
          const state = await access.handleLocal(method, path, {});
          if (state === null) throw new HttpError(404, 'not found');
          return sendJson(res, 200, state);
        }
        const hit = await handleJson(ctx, 'GET', path, query, {});
        if (hit === null) throw new HttpError(404, 'not found');
        return sendJson(res, 200, hit);
      }
      if (method !== 'POST') throw new HttpError(405, 'method not allowed');

      // команда CLI — без Origin, опознаётся токеном управления; проверка Origin её не пропустит
      if (path === '/api/mode') {
        await switchMode(req, res); // без await отказ улетал бы мимо catch и ронял сервер
        return;
      }

      if (!originAllowed(req.headers, policy)) throw new HttpError(403, 'request did not come from this page');
      if (limiter && !limiter.take(ip, POSTS_PER_MINUTE, 60e3)) throw new HttpError(429, 'too many requests');

      if (path === '/api/login') {
        if (!auth) return sendJson(res, 200, { ok: true });
        if (limiter && !limiter.take(`login ${ip}`, LOGINS_PER_5_MINUTES, 5 * 60e3)) {
          throw new HttpError(429, 'too many login attempts');
        }
        const body = await readJson(req);
        res.setHeader('Set-Cookie', auth.cookie(auth.login(typeof body.password === 'string' ? body.password : '')));
        return sendJson(res, 200, { ok: true });
      }
      if (path === '/api/logout') {
        auth?.logout(req);
        if (auth) res.setHeader('Set-Cookie', auth.clearCookie());
        return sendJson(res, 200, { ok: true });
      }
      if (auth && !auth.valid(req)) throwUnauthorized();

      if (path.startsWith('/api/access')) {
        const state = await access.handleLocal(method, path, await readJson(req));
        if (state === null) throw new HttpError(404, 'not found');
        return sendJson(res, 200, state);
      }
      if (path === '/api/attach' || path === '/api/chat-attach') {
        const data = await readBody(req, UPLOAD_LIMIT);
        const name = query.get('name') ?? '';
        const file =
          path === '/api/attach'
            ? attachToCard(ctx, query.get('card') ?? '', name, data)
            : postOwnerAttachment(ctx.board, query.get('q') ?? '', name, data);
        return sendJson(res, 200, { file });
      }
      const hit = await handleJson(ctx, 'POST', path, query, await readJson(req));
      if (hit === null) throw new HttpError(404, 'not found');
      return sendJson(res, 200, hit);
    } catch (e) {
      respondError(res, e);
    }
  }

  return Object.assign(server, { handle, access });
}

function throwUnauthorized(): never {
  throw new HttpError(401, 'password required');
}

function serveIndex(res: ServerResponse, uiDir: string): void {
  const html = readText(join(uiDir, 'index.html'));
  if (html === null) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`${APP}: UI is not built — npm run build`);
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': CSP_APP,
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
}

function serveStatic(res: ServerResponse, uiDir: string, pathname: string): void {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname.slice('/static/'.length));
  } catch {
    throw new HttpError(404, 'not found');
  }
  const root = uiDir; // URL /static/<файл> → <сборка>/<файл>
  const file = join(root, rel);
  const inside = relative(root, file);
  const type = STATIC_TYPES[extname(file).toLowerCase()];
  if (rel === '' || inside.startsWith('..') || isAbsolute(inside) || type === undefined || !isRealFile(file)) {
    throw new HttpError(404, 'not found');
  }
  const data = readFileSyncSafe(file);
  if (data === null) throw new HttpError(404, 'not found');
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': data.length,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Security-Policy': extname(file) === '.svg' ? CSP_SANDBOX : CSP_APP,
  });
  res.end(data);
}

/** Вложение: картинки — в страницу, остальное — скачиванием; любой открытый файл — в песочнице. */
function sendAttachment(res: ServerResponse, file: string): void {
  const data = readFileSyncSafe(file);
  if (data === null) throw new HttpError(404, 'file not found');
  const ext = extname(file).toLowerCase();
  const inline = INLINE_TYPES[ext];
  const name = encodeURIComponent(basename(file)).replace(
    /['()*]/gu,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  res.writeHead(200, {
    'Content-Type': inline ?? 'application/octet-stream',
    'Content-Disposition': `${inline !== undefined ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
    'Content-Length': data.length,
    'Content-Security-Policy': CSP_SANDBOX,
  });
  res.end(data);
}

export async function startServer(options: ServerOptions): Promise<Running> {
  let control = '';
  const server = createBoardServer({
    ...options,
    onControl: (token) => {
      control = token;
      options.onControl?.(token);
    },
  });
  const port = await listenWithFallback(server, options.port ?? 8777, options.host ?? '127.0.0.1');
  return {
    server,
    port,
    control,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
