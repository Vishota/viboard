// Удалённый доступ (UD-55). Один порт — локальный, без пароля (слово владельца: локальному окну пароль не нужен).
// Туннель virunx указывает на второй, внутренний слушатель: всё, что пришло на него, — удалённое, и требует
// сессии устройства. Так «выдать себя за локального» нельзя в принципе: удалённый посетитель не выбирает,
// на какой порт попадёт его запрос, а заголовкам мы не верим.
// Почему не различать по Host на одном порту: клиент virunx сам переписывает Host на localhost (по умолчанию)
// и передаёт заголовки посетителя как есть — по прямому каналу их задаёт его браузер.

import { join } from 'node:path';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { DEVICE_COOKIE, DEVICE_TTL_MS, Devices, PairingKey, deviceName } from '../core/access.js';
import { configDir } from '../core/board.js';
import { ROOT } from '../core/paths.js';
import { TUNNEL_TOOL, findTunnelTool, installTunnelTool, startTunnel, type Tunnel } from '../core/tunnel.js';
import type { AccessState, TunnelTool } from '../core/types.js';
import {
  HttpError,
  RateLimiter,
  listenOnce,
  originAllowed,
  readBody,
  readCookie,
  respondError,
  securityHeaders,
  sendJson,
} from './http.js';

const DEVICE_ERROR = { error: 'device access required', auth: 'device' };
const KEY_ERROR = { error: 'unknown or expired key', auth: 'device' };

function parseKeyBody(raw: string): { key?: unknown } {
  try {
    const value: unknown = raw === '' ? {} : JSON.parse(raw);
    const body: { key?: unknown } =
      typeof value === 'object' && value !== null ? { key: (value as { key: unknown }).key } : {};
    return body;
  } catch {
    throw new HttpError(400, 'expected a JSON object');
  }
}

/** В exe пакет лежит в app.asar; инструменты electron-builder выкладывает рядом, в app.asar.unpacked. */
const unpacked = (path: string): string => path.replace(/app\.asar([\\/])/u, 'app.asar.unpacked$1');

export interface AccessManagerOptions {
  /** Порт локального слушателя — удалённый берётся следующим свободным. */
  localPort: () => number;
  /** Обработчик локального слушателя: удалённые запросы передаются ему как доверенный прокси. */
  localHandle: (req: IncomingMessage, res: ServerResponse) => void;
  /** Где искать клиент туннеля: сначала вшитый (exe), затем поставленный по согласию. */
  toolRoots: readonly string[];
  /** Куда ставить клиент туннеля по согласию. */
  installDir: string;
  /** Файл подключённых устройств. */
  devicesFile: string;
  /** Включён ли режим с паролем (`viboard public`): с открытым доступом окна они не сочетаются. */
  passwordMode: () => boolean;
  /** Строки клиента туннеля (для журнала и проверок). */
  onLog?: (line: string) => void;
}

export class AccessManager {
  private readonly devices: Devices;
  private readonly pairing = new PairingKey();
  private readonly limiter = new RateLimiter();
  private tunnel: Tunnel | null = null;
  private remote: http.Server | null = null;
  private remotePort = 0;
  private error: string | null = null;
  private opening: Promise<AccessState> | null = null;

  constructor(private readonly options: AccessManagerOptions) {
    this.devices = new Devices(options.devicesFile);
  }

  private pairingKey(): AccessState['key'] {
    const current = this.pairing.get();
    return current === null ? null : { value: current.key, expiresAt: current.expiresAt };
  }

  /** Порт внутреннего слушателя — на него смотрит туннель. */
  get port(): number {
    return this.remotePort;
  }

  state(): AccessState {
    return {
      tool: toolView(findTunnelTool(this.options.toolRoots)),
      toolVersion: TUNNEL_TOOL.version,
      on: this.tunnel !== null,
      url: this.tunnel?.url ?? null,
      key: this.pairingKey(),
      devices: this.devices.list(),
      error: this.error,
    };
  }

  /** По согласию владельца: поставить клиент туннеля точно заданной версии (npm рядом с node). */
  async install(): Promise<void> {
    await installTunnelTool(this.options.installDir);
  }

  /** Открыть доступ: внутренний слушатель, туннель и ключ для первого устройства. */
  open(): Promise<AccessState> {
    if (this.opening !== null) return this.opening;
    this.opening = this.doOpen().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async doOpen(): Promise<AccessState> {
    this.error = null;
    if (this.options.passwordMode()) {
      throw new HttpError(409, 'password access is on (viboard public) — turn it off first: viboard local <password>');
    }
    if (this.tunnel === null) {
      const tool = findTunnelTool(this.options.toolRoots);
      if (tool.cli === null) throw new HttpError(409, 'the tunnel tool is not installed');
      try {
        if (this.remote === null) this.remote = await this.listenRemote();
        this.tunnel = await startTunnel({
          cli: tool.cli,
          port: this.remotePort,
          onLog: this.options.onLog,
          onExit: (reason) => void this.tunnelDied(reason),
        });
      } catch (e) {
        await this.close();
        this.error = e instanceof Error ? e.message : String(e);
        throw new HttpError(502, this.error);
      }
    }
    this.pairing.issue();
    return this.state();
  }

  private async listenRemote(): Promise<http.Server> {
    const remote = http.createServer((req, res) => void this.handleRemote(req, res));
    // порт любой: система не выдаст зарезервированный (Hyper-V резервирует сотни портов подряд — окно «+20» за локальным целиком попадало в резерв)
    await listenOnce(remote, 0, '127.0.0.1');
    const address = remote.address();
    if (address === null || typeof address === 'string') throw new Error('the remote listener is not listening');
    this.remotePort = address.port;
    return remote;
  }

  /** Клиент туннеля упал сам: доступ закрывается целиком, чтобы не остаться наполовину открытым. */
  private async tunnelDied(reason: string): Promise<void> {
    if (this.tunnel === null) return;
    this.tunnel = null;
    await this.close();
    this.error = reason || 'the tunnel has stopped';
  }

  async close(): Promise<void> {
    const tunnel = this.tunnel;
    this.tunnel = null;
    this.pairing.clear();
    await tunnel?.stop();
    const remote = this.remote;
    this.remote = null;
    if (remote !== null) {
      remote.closeAllConnections();
      await new Promise<void>((resolve) => remote.close(() => resolve()));
    }
  }

  /** Запрос владельца с этого же устройства: управление доступом. */
  async handleLocal(method: string, path: string, body: Record<string, unknown>): Promise<object | null> {
    if (!path.startsWith('/api/access')) return null;
    const post = method === 'POST';
    switch (path) {
      case '/api/access':
        if (!post) return this.state();
        throw new HttpError(405, 'method not allowed');
      case '/api/access/install':
        if (!post) break;
        await this.install();
        return this.state();
      case '/api/access/open':
        if (!post) break;
        return this.open();
      case '/api/access/key':
        if (!post) break;
        if (this.tunnel === null) throw new HttpError(409, 'access is not open');
        this.pairing.issue();
        return this.state();
      case '/api/access/close':
        if (!post) break;
        this.error = null;
        await this.close();
        return this.state();
      case '/api/access/revoke':
        if (!post) break;
        if (typeof body.id !== 'string' || !this.devices.revoke(body.id)) throw new HttpError(404, 'device not found');
        return this.state();
      default:
        return null;
    }
    throw new HttpError(405, 'method not allowed');
  }

  /** Удалённый слушатель: только туннель. Управление доступом отсюда недоступно даже подключённому устройству. */
  private async handleRemote(req: IncomingMessage, res: ServerResponse): Promise<void> {
    securityHeaders(res);
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname;
      const method = req.method ?? 'GET';
      if (path.startsWith('/api/access')) throw new HttpError(404, 'not found');
      if (path === '/api/pairing') return sendJson(res, 200, { open: this.pairing.get() !== null });
      if (path === '/api/pair') {
        await this.pair(req, res); // без await отказ улетел бы мимо catch и запрос завис бы
        return;
      }

      // без сессии устройство получает только оболочку страницы: подключиться по ключу оно должно суметь
      const shell =
        method === 'GET' &&
        (path === '/' || path === '/index.html' || path.startsWith('/static/') || path === '/api/ping');
      const device = this.devices.resolve(readCookie(req.headers.cookie, DEVICE_COOKIE) ?? '');
      if (device === null && !shell) return sendJson(res, 401, DEVICE_ERROR);
      // своя проверка Origin: ниже заголовки переписываются под локальный слушатель, его проверка бы прошла
      if (method !== 'GET' && !originAllowed(req.headers, { devOrigins: [], publicAccess: true })) {
        throw new HttpError(403, 'request did not come from this page');
      }
      const local = `127.0.0.1:${this.options.localPort()}`;
      req.headers.host = local;
      if (typeof req.headers.origin === 'string') req.headers.origin = `http://${local}`;
      delete req.headers.referer;
      this.options.localHandle(req, res);
    } catch (e) {
      respondError(res, e);
    }
  }

  /** Подключение по одноразовому ключу: устройство получает свою сессию, ключ гаснет. */
  private async pair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
    if (!originAllowed(req.headers, { devOrigins: [], publicAccess: true })) {
      throw new HttpError(403, 'request did not come from this page');
    }
    // за туннелем у всех один адрес — лимит общий на попытки подбора ключа
    if (!this.limiter.take('pair', 10, 60e3)) throw new HttpError(429, 'too many attempts');
    const raw = (await readBody(req, 4096)).toString('utf8');
    const key = parseKeyBody(raw).key;
    if (typeof key !== 'string' || !this.pairing.take(key)) throw new HttpError(401, KEY_ERROR.error);
    const { token } = this.devices.issue(deviceName(req.headers['user-agent']));
    res.setHeader(
      'Set-Cookie',
      `${DEVICE_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${DEVICE_TTL_MS / 1000}`,
    );
    sendJson(res, 200, { ok: true });
  }
}

/** Владельцу — состояние инструмента без путей. */
function toolView(tool: { state: TunnelTool['state']; source: TunnelTool['source'] }): TunnelTool {
  return { state: tool.state, source: tool.source };
}

/** Менеджер по стандартным путям: инструмент туннеля и устройства живут в папке настроек. */
export interface TunnelSetup {
  toolRoots?: string[];
  installDir?: string;
  devicesFile?: string;
  onLog?: (line: string) => void;
}

export function createAccessManager(
  options: {
    localPort: () => number;
    localHandle: (req: IncomingMessage, res: ServerResponse) => void;
    passwordMode: () => boolean;
  } & TunnelSetup,
): AccessManager {
  const config = configDir();
  return new AccessManager({
    ...options,
    toolRoots: options.toolRoots ?? [unpacked(join(ROOT, 'tools')), join(config, 'tools')],
    installDir: options.installDir ?? join(config, 'tools'),
    devicesFile: options.devicesFile ?? join(config, 'devices.json'),
  });
}
