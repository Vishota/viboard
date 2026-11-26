import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http, { type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEVICE_COOKIE, Devices, KEY_TTL_MS, PairingKey, deviceName, randomCode } from '../../src/core/access.js';
import { listCards } from '../../src/core/board.js';
import { PROTOCOL_DIR } from '../../src/core/paths.js';
import { findTunnelTool, npmCandidates, startTunnel } from '../../src/core/tunnel.js';
import { createBoardServer, listenWithFallback, type BoardServer } from '../../src/server/server.js';
import { initBoard } from '../../src/core/setup.js';

// Удалённый доступ (UD-55): туннель смотрит на внутренний слушатель; всё, что пришло на него, — удалённое
// и требует сессии устройства. Клиент туннеля здесь — подделка: печатает ссылку, свои аргументы и pid и живёт.

const PUBLIC_HOST = 'viboard-test.run.vishota.com';

interface Reply {
  status: number;
  body: string;
  cookie: string | undefined;
}

interface Request {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
}

function call(port: number, request: Request = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: request.method ?? 'GET', path: request.path ?? '/', headers: request.headers },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            cookie: res.headers['set-cookie']?.[0],
          }),
        );
      },
    );
    req.on('error', reject);
    if (request.body !== undefined) req.write(request.body);
    req.end();
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** Строка журнала туннеля с таким началом: строки приходят отдельными порциями — ждём нужную. */
async function logLine(prefix: string, lines: string[] = logs): Promise<string> {
  for (let i = 0; i < 150; i++) {
    const found = lines.find((line) => line.startsWith(prefix));
    if (found !== undefined) return found;
    await sleep(20);
  }
  throw new Error(`no line «${prefix}» in the tunnel log`);
}
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let root = '';
let board = '';
let localPort = 0;
let manager: BoardServer['access'];
let logs: string[] = [];
let server: BoardServer;
let control = '';
let sequence = 0;
const hadHome = process.env.VIBOARD_HOME;

/** Подделка virunx. failTimes — сколько первых запусков отвечают «имя занято» и падают. */
function fakeTool(dir: string, failTimes = 0): string {
  const pkg = join(dir, 'node_modules', 'virunx');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({ name: 'virunx', version: '0.5.0', bin: { virunx: 'cli.js' } }),
  );
  const counter = join(dir, 'runs').replaceAll('\\', '/');
  const cli = [
    "import { readFileSync, writeFileSync, existsSync } from 'node:fs';",
    `const file = ${JSON.stringify(counter)};`,
    'const n = (existsSync(file) ? Number(readFileSync(file, "utf8")) : 0) + 1;',
    'writeFileSync(file, String(n));',
    "console.log('virunx 0.5.0');",
    `if (n <= ${failTimes}) { console.error('  error    id is taken (id-taken)'); process.exit(1); }`,
    `console.log('  live     https://' + ${JSON.stringify(PUBLIC_HOST)} + '/' + n);`,
    "console.log('  args ' + JSON.stringify(process.argv.slice(2)));",
    "console.log('  pid ' + process.pid);",
    'setInterval(() => {}, 1000);',
  ].join('\n');
  writeFileSync(join(pkg, 'cli.js'), cli);
  return join(pkg, 'cli.js');
}

async function boot(options: { tool?: 'ready' | 'missing' | 'failing' } = {}): Promise<void> {
  const n = ++sequence;
  const home = join(root, `home-${n}`);
  mkdirSync(home, { recursive: true });
  process.env.VIBOARD_HOME = home;
  const ui = join(root, `ui-${n}`);
  mkdirSync(join(ui, 'static'), { recursive: true });
  writeFileSync(join(ui, 'index.html'), '<!doctype html><title>viboard</title>');
  writeFileSync(join(ui, 'app.js'), 'globalThis.x = 1;');
  const tools = join(root, `tools-${n}`);
  logs = [];
  server = createBoardServer({
    board,
    port: 0,
    uiDir: ui,
    onControl: (token) => (control = token),
    tunnel: {
      toolRoots: options.tool === 'missing' ? [] : [tools],
      installDir: join(home, 'tools'),
      devicesFile: join(home, 'devices.json'),
      onLog: (line: string) => logs.push(line),
    },
  });
  localPort = await listenWithFallback(server, 0, '127.0.0.1');
  manager = server.access;
  if (options.tool !== 'missing') fakeTool(join(root, `tools-${n}`), options.tool === 'failing' ? 99 : 0);
}

const local = (path: string, method = 'GET', body?: string): Promise<Reply> =>
  call(localPort, {
    path,
    method,
    body,
    headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${localPort}` },
  });
const remote = (path: string, request: Request = {}): Promise<Reply> =>
  call(manager.port, {
    path,
    ...request,
    headers: { Host: PUBLIC_HOST, 'Content-Type': 'application/json', ...request.headers },
  });
const origin = { Origin: `https://${PUBLIC_HOST}` };
const tunnelPid = async (): Promise<number> => Number((await logLine('  pid ')).slice('  pid '.length));

async function open(): Promise<{ url: string; key: string }> {
  const reply = await local('/api/access/open', 'POST', '{}');
  expect(reply.status, reply.body).toBe(200);
  const state = JSON.parse(reply.body) as { url: string; key: { value: string } };
  return { url: state.url, key: state.key.value };
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'viboard-access-'));
  board = join(root, 'board');
  await initBoard({
    board,
    project: { name: 'Test', path: root },
    protocolDir: PROTOCOL_DIR,
    version: '0.1.0-test',
    noGit: true,
  });
});
afterAll(() => {
  if (hadHome === undefined) delete process.env.VIBOARD_HOME;
  else process.env.VIBOARD_HOME = hadHome;
  rmSync(root, { recursive: true, force: true });
});

describe('ключ и устройства — чистая логика', () => {
  it('ключ одноразовый и живёт две минуты', () => {
    const pairing = new PairingKey();
    expect(pairing.get(0)).toBeNull();
    const { key, expiresAt } = pairing.issue(1000);
    expect(expiresAt).toBe(1000 + KEY_TTL_MS);
    expect(key).toMatch(/^[a-hjkmnp-z23456789]{6}$/u);
    expect(pairing.take(`${key.toUpperCase()} `, 1500)).toBe(true); // регистр и пробел не мешают ввести вручную
    expect(pairing.get(1500)).toBeNull(); // погашен первым успехом
    expect(pairing.take(key, 1500)).toBe(false);
    const second = pairing.issue(2000).key;
    expect(pairing.get(2000 + KEY_TTL_MS)).toBeNull(); // истёк
    expect(pairing.take(second, 2000 + KEY_TTL_MS)).toBe(false);
  });

  it('устройства: токен хранится хэшем, переживает перезапуск, отзывается; протухшие отбрасываются', () => {
    const file = join(root, 'devices.json');
    const { token } = new Devices(file).issue('iPhone · Safari');
    expect(readFileSync(file, 'utf8')).not.toContain(token);
    const again = new Devices(file);
    expect(again.resolve(token)?.name).toBe('iPhone · Safari');
    expect(again.resolve('not-a-token')).toBeNull();
    const id = again.list()[0]?.id ?? '';
    expect(again.revoke(id)).toBe(true);
    expect(new Devices(file).resolve(token)).toBeNull();
    expect(again.revoke(id)).toBe(false);
    new Devices(file).issue('Old', new Date(Date.now() - 40 * 24 * 3600e3));
    expect(new Devices(file).list()).toHaveLength(0);
  });

  it('имя по браузеру; код — без похожих символов', () => {
    expect(
      deviceName(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('iPhone/iPad · Safari');
    expect(
      deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0'),
    ).toBe('Windows · Edge');
    expect(deviceName(undefined)).toBe('Unknown browser');
    for (let i = 0; i < 50; i++) expect(randomCode(8)).toMatch(/^[a-hjkmnp-z23456789]{8}$/u);
  });
});

describe('клиент туннеля', () => {
  it('находится по package.json и bin в первом корне, где есть; иначе missing; npm ищется рядом с node', () => {
    const dir = join(root, 'tool-lookup');
    fakeTool(dir);
    expect(findTunnelTool([join(dir, 'no'), dir])).toMatchObject({ state: 'ready', source: 'installed' });
    expect(findTunnelTool([dir])).toMatchObject({ state: 'ready', source: 'bundled' });
    expect(findTunnelTool([])).toEqual({ state: 'missing', source: null, cli: null });
    expect(Array.isArray(npmCandidates())).toBe(true);
  });

  it('запускается скрытым и без подмены имени, ссылку берёт из строки live; «имя занято» — другое имя; останавливается', async () => {
    const cli = fakeTool(join(root, 'tool-run'), 1); // первый запуск падает
    const lines: string[] = [];
    const tunnel = await startTunnel({ cli, port: 4321, onLog: (line) => lines.push(line) });
    expect(tunnel.url).toBe(`https://${PUBLIC_HOST}/2`); // со второй попытки
    const args = JSON.parse((await logLine('  args ', lines)).slice('  args '.length)) as string[];
    expect(args.slice(0, 2)).toEqual(['-p', '4321']);
    expect(args.slice(2, 4)).toEqual(['-s', expect.stringMatching(/^viboard-[a-hjkmnp-z23456789]{4}$/u)]);
    expect(args.slice(4)).toEqual(['--hidden', '--no-rewrite-host', '--yes']);
    const pid = Number((await logLine('  pid ', lines)).slice('  pid '.length));
    expect(Number.isInteger(pid)).toBe(true);
    await tunnel.stop();
    await sleep(300);
    expect(alive(pid)).toBe(false);
  });

  it('три неудачи подряд — отказ с последней строкой клиента', async () => {
    const cli = fakeTool(join(root, 'tool-fail'), 99);
    await expect(startTunnel({ cli, port: 4322 })).rejects.toThrow(/id-taken/u);
  });
});

describe('удалённый слушатель', () => {
  beforeEach(async () => {
    await boot();
  });
  afterEach(async () => {
    await manager.close().catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('до открытия: доступ закрыт, внутренний порт не отвечает', async () => {
    const state = JSON.parse((await local('/api/access')).body) as { on: boolean; tool: { state: string } };
    expect(state.on).toBe(false);
    expect(state.tool.state).toBe('ready');
    await expect(remote('/api/ping')).rejects.toThrow();
  });

  it('без сессии устройство получает только оболочку страницы; управление доступом с туннеля недоступно', async () => {
    await open();
    const denied = await remote('/api/state');
    expect(denied.status).toBe(401);
    expect(JSON.parse(denied.body)).toMatchObject({ auth: 'device' });
    expect((await remote('/')).status).toBe(200);
    expect((await remote('/static/app.js')).status).toBe(200);
    expect((await remote('/api/ping')).status).toBe(200);
    expect((await remote('/api/access')).status).toBe(404);
    expect((await remote('/api/access/open', { method: 'POST', body: '{}' })).status).toBe(404);
    expect((await remote('/api/pairing')).body).toBe('{"open":true}');
  });

  it('подключение: неверный ключ — 401, чужой Origin — 403, верный — своя сессия; ключ одноразовый', async () => {
    const { key } = await open();
    expect(
      (await remote('/api/pair', { method: 'POST', body: JSON.stringify({ key: 'aaaaaa' }), headers: origin })).status,
    ).toBe(401);
    expect(
      (
        await remote('/api/pair', {
          method: 'POST',
          body: JSON.stringify({ key }),
          headers: { Origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    const paired = await remote('/api/pair', { method: 'POST', body: JSON.stringify({ key }), headers: origin });
    expect(paired.status, paired.body).toBe(200);
    expect(paired.cookie).toMatch(
      new RegExp(`^${DEVICE_COOKIE}=[0-9a-f]{64}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=\\d+$`, 'u'),
    );
    expect((await remote('/api/pair', { method: 'POST', body: JSON.stringify({ key }), headers: origin })).status).toBe(
      401,
    );

    const device = { Cookie: paired.cookie?.split(';')[0] ?? '', Origin: `https://${PUBLIC_HOST}` };
    const state = await remote('/api/state', { headers: device });
    expect(state.status).toBe(200);
    expect(JSON.parse(state.body)).toMatchObject({ root: board });
    // запись с телефона доходит до доски; запрос чужой страницы — нет
    const created = await remote('/api/card', {
      method: 'POST',
      body: JSON.stringify({ project: 'test', title: 'From phone', body: 'text' }),
      headers: device,
    });
    expect(created.status, created.body).toBe(200);
    expect(listCards(board).map((c) => c.title)).toEqual(['From phone']);
    expect(
      (
        await remote('/api/card', {
          method: 'POST',
          body: '{}',
          headers: { ...device, Origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    // подключённое устройство не управляет доступом
    expect((await remote('/api/access', { headers: device })).status).toBe(404);
    expect((await remote('/api/access/revoke', { method: 'POST', body: '{}', headers: device })).status).toBe(404);
    const mine = JSON.parse((await local('/api/access')).body) as { devices: { name: string }[] };
    expect(mine.devices).toHaveLength(1);
  });

  it('отзыв обрывает сессию устройства; устройства помнят по файлу', async () => {
    const { key } = await open();
    const paired = await remote('/api/pair', { method: 'POST', body: JSON.stringify({ key }), headers: origin });
    const cookie = paired.cookie?.split(';')[0] ?? '';
    const before = JSON.parse((await local('/api/access')).body) as { devices: { id: string }[] };
    expect((await local('/api/access/revoke', 'POST', JSON.stringify({ id: before.devices[0]?.id }))).status).toBe(200);
    expect((await remote('/api/state', { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await local('/api/access/revoke', 'POST', JSON.stringify({ id: 'nope' }))).status).toBe(404);
    expect(new Devices(join(process.env.VIBOARD_HOME ?? '', 'devices.json')).list()).toHaveLength(0);
  });

  it('новый ключ — для следующего устройства и заменяет прежний; после закрытия подключения нет', async () => {
    const first = await open();
    const second = JSON.parse((await local('/api/access/key', 'POST', '{}')).body) as { key: { value: string } };
    expect(second.key.value).not.toBe(first.key);
    expect(
      (await remote('/api/pair', { method: 'POST', body: JSON.stringify({ key: first.key }), headers: origin })).status,
    ).toBe(401);
    expect(
      (await remote('/api/pair', { method: 'POST', body: JSON.stringify({ key: second.key.value }), headers: origin }))
        .status,
    ).toBe(200);
    await local('/api/access/close', 'POST', '{}');
    expect(JSON.parse((await local('/api/access')).body)).toMatchObject({ on: false, key: null });
    await expect(remote('/api/pairing')).rejects.toThrow();
    expect((await local('/api/access/key', 'POST', '{}')).status).toBe(409);
  });

  it('закрытие останавливает туннель и внутренний слушатель; `viboard public` при открытом доступе отказывает', async () => {
    const { url } = await open();
    expect(url).toBe(`https://${PUBLIC_HOST}/1`);
    const args = JSON.parse((await logLine('  args ')).slice('  args '.length)) as string[];
    expect(args.slice(0, 2)).toEqual(['-p', String(manager.port)]);
    expect(args.slice(2, 4)).toEqual(['-s', expect.stringMatching(/^viboard-[a-hjkmnp-z23456789]{4}$/u)]);
    expect(args.slice(4)).toEqual(['--hidden', '--no-rewrite-host', '--yes']);
    const pid = await tunnelPid();
    const switched = await call(localPort, {
      method: 'POST',
      path: '/api/mode',
      headers: { 'Content-Type': 'application/json', Authorization: `Control ${control}` },
      body: JSON.stringify({ public: true, password: 'x' }),
    });
    expect(switched.status).toBe(409);
    const closed = JSON.parse((await local('/api/access/close', 'POST', '{}')).body) as { on: boolean; key: unknown };
    expect(closed.on).toBe(false);
    expect(closed.key).toBeNull();
    await sleep(400);
    expect(alive(pid)).toBe(false);
    await expect(remote('/api/ping')).rejects.toThrow();
  });

  it('упавший туннель закрывает доступ и оставляет причину', async () => {
    await open();
    process.kill(await tunnelPid());
    await sleep(1500);
    const state = JSON.parse((await local('/api/access')).body) as { on: boolean; error: string | null };
    expect(state.on).toBe(false);
    expect(state.error).not.toBeNull();
    await expect(remote('/api/ping')).rejects.toThrow();
  });

  it('без клиента туннеля доступ не открывается; неудачные запуски — причина в состоянии', async () => {
    await manager.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await boot({ tool: 'missing' });
    const missing = await local('/api/access/open', 'POST', '{}');
    expect(missing.status).toBe(409);
    expect(missing.body).toContain('not installed');
    await boot({ tool: 'failing' });
    const failed = await local('/api/access/open', 'POST', '{}');
    expect(failed.status).toBe(502);
    const state = JSON.parse((await local('/api/access')).body) as { on: boolean; error: string | null };
    expect(state).toMatchObject({ on: false });
    expect(state.error).toMatch(/id-taken/u);
    await expect(remote('/api/ping')).rejects.toThrow();
  });
});
