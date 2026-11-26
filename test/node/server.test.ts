import { VERSION } from '../../src/core/version.js';
import http, { type IncomingMessage } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listCards, oneCard, summaryOf } from '../../src/core/board.js';
import { Fail } from '../../src/core/errors.js';
import { PROTOCOL_DIR } from '../../src/core/paths.js';
import { ask, claim, createCard } from '../../src/core/ops.js';
import { initBoard } from '../../src/core/setup.js';
import type { BoardState, CardDetail } from '../../src/core/types.js';
import { createBoardServer, listenWithFallback, type ServerOptions } from '../../src/server/server.js';

const root = mkdtempSync(join(tmpdir(), 'viboard-server-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  cookie: string | undefined;
}

interface Request {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
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
            headers: res.headers,
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

let counter = 0;

async function boot(extra: Partial<ServerOptions> = {}): Promise<{
  port: number;
  board: string;
  origin: string;
  close: () => Promise<void>;
}> {
  const n = ++counter;
  const board = join(root, `board-${n}`);
  await initBoard({
    board,
    project: { name: 'Тест', path: root },
    protocolDir: PROTOCOL_DIR,
    version: '0.1.0-test',
    noGit: true,
  });
  const ui = join(root, `ui-${n}`);
  mkdirSync(ui, { recursive: true });
  writeFileSync(join(ui, 'index.html'), '<!doctype html><title>viboard</title>');
  writeFileSync(join(ui, 'app.js'), 'globalThis.x = 1;');
  writeFileSync(join(root, 'secret.txt'), 'secret');
  const server = createBoardServer({ board, uiDir: ui, ...extra });
  const port = await listenWithFallback(server, 0, '127.0.0.1');
  return {
    port,
    board,
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const post = (origin: string, path: string, body: unknown, headers: Record<string, string> = {}): Request => ({
  method: 'POST',
  path,
  headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

describe('локальный режим', () => {
  it('страница и статика: заголовки безопасности, без выхода за каталог', async () => {
    const app = await boot();
    const page = await call(app.port);
    expect(page.status).toBe(200);
    expect(page.body).toContain('<title>viboard</title>');
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");
    expect(page.headers['content-security-policy']).not.toContain('unsafe-inline');
    expect(page.headers['x-powered-by']).toBe(`viboard/${VERSION}`);
    expect(page.headers['x-frame-options']).toBe('DENY');
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.headers['cache-control']).toBe('no-store');

    const script = await call(app.port, { path: '/static/app.js' });
    expect(script.status).toBe(200);
    expect(script.headers['content-type']).toContain('text/javascript');
    expect(script.headers['cache-control']).toContain('immutable');

    expect((await call(app.port, { path: '/static/..%2Fsecret.txt' })).status).toBe(404);
    expect((await call(app.port, { path: '/static/%2e%2e/secret.txt' })).status).toBe(404);
    expect((await call(app.port, { path: '/static/..%5csecret.txt' })).status).toBe(404);
    expect((await call(app.port, { path: '/secret.txt' })).status).toBe(404);
    expect((await call(app.port, { path: '/static/' })).status).toBe(404);
    await app.close();
  });

  it('DNS rebinding: чужой Host — 403; без пароля принимается только 127.0.0.1 (UD-55)', async () => {
    const app = await boot();
    expect((await call(app.port, { headers: { Host: 'evil.example' } })).status).toBe(403);
    expect((await call(app.port, { headers: { Host: 'evil.example' }, path: '/api/state' })).status).toBe(403);
    expect((await call(app.port, { path: '/api/ping' })).status).toBe(200);
    // «localhost» подставляет туннель, переписывающий имя (virunx по умолчанию): доска без пароля не должна
    // принимать такой запрос за локальный
    const rewritten = await call(app.port, { headers: { Host: `localhost:${app.port}` }, path: '/api/ping' });
    expect(rewritten.status).toBe(403);
    expect(rewritten.body).toContain('http://127.0.0.1:');
    await app.close();

    // за паролем имя может быть любым — как раньше
    const locked = await boot({ password: 'секрет' });
    expect((await call(locked.port, { headers: { Host: `localhost:${locked.port}` }, path: '/api/ping' })).status).toBe(
      200,
    );
    await locked.close();
  });

  it('CSRF: запись только с этой страницы и только с JSON', async () => {
    const app = await boot();
    const card = { project: 'test', title: 'Задача', body: 'Текст' };
    expect((await call(app.port, post(app.origin, '/api/card', card, { Origin: '' }))).status).toBe(403);
    expect((await call(app.port, post('http://evil.example', '/api/card', card))).status).toBe(403);
    expect((await call(app.port, post(app.origin, '/api/card', card, { 'Content-Type': 'text/plain' }))).status).toBe(
      415,
    );
    expect((await call(app.port, { method: 'PUT', path: '/api/card' })).status).toBe(405);
    expect(
      (
        await call(app.port, {
          method: 'POST',
          path: '/api/nothing',
          headers: { Origin: app.origin, 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(404);
    expect((await call(app.port, { path: '/api/nothing' })).status).toBe(404);
    expect(listCards(app.board)).toHaveLength(0);
    await app.close();
  });

  it('состояние, карточка и чтение по id', async () => {
    const app = await boot();
    const state = (await call(app.port, { path: '/api/state' })).body;
    const parsed = JSON.parse(state) as BoardState;
    expect(parsed.columns).toEqual(['backlog', 'todo', 'doing', 'blocked', 'review', 'done']);
    expect(parsed.cards).toEqual([]);
    expect(parsed.projects.map((p) => p.id)).toEqual(['test']);
    expect(Object.keys(parsed.prompts).sort()).toEqual(['board', 'executor', 'manager', 'reviewer']);
    expect(parsed.prompts.board).toContain('AGENTS.md');
    expect(parsed.protocol).toEqual({ installed: '0.1.0-test', current: VERSION });

    const created = await call(
      app.port,
      post(app.origin, '/api/card', { project: 'test', title: 'Задача', body: 'Текст', priority: 2 }),
    );
    expect(created.status).toBe(200);
    expect(JSON.parse(created.body)).toMatchObject({ card: { name: 'test-001-zadacha', column: 'todo' } });

    const detail = JSON.parse((await call(app.port, { path: '/api/card?id=001' })).body) as CardDetail;
    expect(detail.card.title).toBe('Задача');
    expect(detail.entries).toEqual([]);

    expect((await call(app.port, { path: '/api/card?id=999' })).status).toBe(400);
    await app.close();
  });

  it('многобайтовый текст не рвётся на границе чанка; неизвестный проект — 400 с причиной', async () => {
    const app = await boot();
    const text = 'ёжик🦔 и «кавычки»\n'.repeat(400);
    const created = await call(
      app.port,
      post(app.origin, '/api/card', { project: 'test', title: 'Ёжики', body: text, priority: '1' }),
    );
    expect(created.status).toBe(200);
    expect(oneCard(app.board, '001').body).toBe(text.trim());

    const unknown = await call(app.port, post(app.origin, '/api/card', { project: 'nope', title: 'x', body: 'y' }));
    expect(unknown.status).toBe(400);
    expect(JSON.parse(unknown.body)).toEqual({ error: 'project «nope» is not in projects.yml' });

    const badPriority = await call(
      app.port,
      post(app.origin, '/api/card', { project: 'test', title: 'x', body: 'y', priority: 7 }),
    );
    expect(badPriority.status).toBe(400);
    await app.close();
  });

  it('занятую карточку интерфейс не двигает', async () => {
    const app = await boot();
    await call(app.port, post(app.origin, '/api/card', { project: 'test', title: 'Занятая', body: 'Текст' }));
    claim(app.board, '001', 'aaaa1111');
    const moved = await call(app.port, post(app.origin, '/api/card/move', { id: '001', to: 'done' }));
    expect(moved.status).toBe(400);
    expect(JSON.parse(moved.body)).toEqual({
      error:
        'test-001-zanyataya: in progress (lock-aaaa1111) — only the lock holder moves it; --force removes the lock',
    });
    await app.close();
  });

  it('вложения: имя очищается, отдаётся только существующий файл и в песочнице', async () => {
    const app = await boot();
    await call(app.port, post(app.origin, '/api/card', { project: 'test', title: 'С файлом', body: 'Текст' }));
    const upload = (name: string, data: Buffer): Request => ({
      method: 'POST',
      path: `/api/attach?card=001&name=${encodeURIComponent(name)}`,
      headers: { Origin: app.origin, 'Content-Type': 'application/octet-stream' },
      body: data,
    });
    const saved = await call(app.port, upload('../../evil.txt', Buffer.from('данные')));
    expect(JSON.parse(saved.body)).toEqual({ file: 'evil.txt' });
    expect((await call(app.port, upload('evil.txt', Buffer.from('данные')))).status).toBe(400);

    const file = await call(app.port, { path: '/api/asset?card=001&f=evil.txt' });
    expect(file.status).toBe(200);
    expect(file.body).toBe('данные');
    expect(file.headers['content-security-policy']).toContain('sandbox');
    expect(file.headers['content-disposition']).toContain('attachment');
    expect((await call(app.port, { path: '/api/asset?card=001&f=..%2FREADME.md' })).status).toBe(400);
    expect((await call(app.port, { path: '/api/asset?card=001&f=README.md' })).status).toBe(400);
    expect((await call(app.port, { path: '/api/asset?card=001' })).status).toBe(400);
    await app.close();
  });

  it('слишком большой JSON — 413; невалидный JSON — 400', async () => {
    const app = await boot();
    const big = await call(
      app.port,
      post(app.origin, '/api/card', { project: 'test', title: 'x', body: 'я'.repeat(700_000) }),
    );
    expect(big.status).toBe(413);
    const broken = await call(app.port, {
      method: 'POST',
      path: '/api/card',
      headers: { Origin: app.origin, 'Content-Type': 'application/json' },
      body: '{"title":',
    });
    expect(broken.status).toBe(400);
    await app.close();
  });

  it('публичный доступ без пароля невозможен', () => {
    expect(() => createBoardServer({ board: root, publicAccess: true })).toThrow(Fail);
  });
});

describe('режим с паролем', () => {
  const login = (origin: string, password: string): Request => post(origin, '/api/login', { password });

  it('без входа — 401; вход выдаёт HttpOnly-cookie; выход её снимает', async () => {
    const app = await boot({ password: 'секрет' });
    expect((await call(app.port, { path: '/api/state' })).status).toBe(401);
    expect(
      (await call(app.port, post(app.origin, '/api/card', { project: 'test', title: 'x', body: 'y' }))).status,
    ).toBe(401);
    expect(
      (
        await call(app.port, {
          method: 'POST',
          path: '/api/login',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(403);

    const wrong = await call(app.port, login(app.origin, 'не то'));
    expect(wrong.status).toBe(401);
    expect(wrong.cookie).toBeUndefined();

    const right = await call(app.port, login(app.origin, 'секрет'));
    expect(right.status).toBe(200);
    expect(right.cookie).toContain('viboard_session=');
    expect(right.cookie).toContain('HttpOnly');
    expect(right.cookie).toContain('SameSite=Strict');
    expect(right.cookie).not.toContain('Secure');

    const auth = { Cookie: right.cookie?.split(';')[0] ?? '' };
    expect((await call(app.port, { path: '/api/state', headers: auth })).status).toBe(200);
    expect((await call(app.port, { path: '/api/ping' })).status).toBe(200); // ping открыт: по нему CLI видит живой сервер

    const out = await call(app.port, post(app.origin, '/api/logout', {}, auth));
    expect(out.headers['set-cookie']?.[0]).toContain('Max-Age=0');
    expect((await call(app.port, { path: '/api/state', headers: auth })).status).toBe(401);
    await app.close();
  });

  it('публичный режим: cookie Secure, любой Host, лимит попыток входа', async () => {
    const app = await boot({ password: 'секрет', publicAccess: true });
    expect((await call(app.port, { headers: { Host: 'board.run.example.com' }, path: '/api/ping' })).status).toBe(200);
    const right = await call(app.port, login(app.origin, 'секрет'));
    expect(right.cookie).toContain('Secure');
    for (let i = 0; i < 9; i++) expect((await call(app.port, login(app.origin, 'мимо'))).status).toBe(401);
    expect((await call(app.port, login(app.origin, 'мимо'))).status).toBe(429);
    await app.close();
  });
});

describe('поиск по тексту (карточка 044)', () => {
  it('находит запрос в постановке и в записях лога, но не в чужих карточках', async () => {
    const app = await boot();
    await call(
      app.port,
      post(app.origin, '/api/card', { project: 'test', title: 'Title only', body: 'the body mentions typography' }),
    );
    await call(app.port, post(app.origin, '/api/card', { project: 'test', title: 'Other', body: 'nothing here' }));
    claim(app.board, '002', 'cccc3333');
    const names = async (q: string): Promise<string[]> =>
      (
        JSON.parse((await call(app.port, { path: `/api/search?q=${encodeURIComponent(q)}` })).body) as {
          names: string[];
        }
      ).names;
    expect(await names('TYPOGRAPHY')).toEqual(['test-001-title-only']);
    expect(await names('claim')).toEqual(['test-002-other']);
    expect(await names('absent')).toEqual([]);
    // служебные поля frontmatter не ищутся: иначе находятся все карточки доски (карточка 044)
    expect(await names('priority')).toEqual([]);
    expect(await names('depends_on')).toEqual([]);
    expect(await names('created')).toEqual([]);
    expect((await call(app.port, { path: '/api/search' })).status).toBe(200);
    await app.close();
  });
});

// Карточка 057 (UD-45): ответ владельца в чате возвращает карточку из blocked/ в todo/, снимает замок,
// ставит запись answer — карточку может взять следующая свободная сессия.
describe('ответ владельца возвращает карточку в todo', () => {
  it('первый ответ: todo/, без замка, запись owner-answer, пометка answered; повтор — ничего не меняет', async () => {
    const app = await boot();
    const card = createCard(app.board, { project: 'test', title: 'Asked', body: 'text' });
    claim(app.board, card.id, 'aaaa1111');
    const { card: blocked, thread } = ask(app.board, card.id, 'aaaa1111', 'A or B?');
    expect(blocked.column).toBe('blocked');

    const answered = await call(app.port, post(app.origin, '/api/chat', { q: thread, text: 'A.' }));
    expect(JSON.parse(answered.body)).toEqual({ file: 'answer.md' });

    const after = oneCard(app.board, card.id);
    expect(after.column).toBe('todo');
    expect(after.lockedBy).toBeNull();
    expect(after.log.filter((f) => f.endsWith('-answer.md'))).toHaveLength(1);
    expect(after.log.find((f) => f.endsWith('-answer.md'))).toContain('-owner-');
    expect(summaryOf(oneCard(app.board, card.id)).answered).toBe(true);

    const again = await call(app.port, post(app.origin, '/api/chat', { q: thread, text: 'And one more thing.' }));
    expect(again.status).toBe(200);
    expect(oneCard(app.board, card.id).column).toBe('todo');
    expect(oneCard(app.board, card.id).log.filter((f) => f.endsWith('-answer.md'))).toHaveLength(1);
    await app.close();
  });

  it('ответ в общей ветке (без карточки) ничего не двигает', async () => {
    const app = await boot();
    const card = createCard(app.board, { project: 'test', title: 'Untouched', body: 'text' });
    claim(app.board, card.id, 'aaaa1111');
    mkdirSync(join(app.board, 'questions', '2026-11-26T100000Z-aaaa1111-q'), { recursive: true });
    writeFileSync(
      join(app.board, 'questions', '2026-11-26T100000Z-aaaa1111-q', 'README.md'),
      '---\nfrom: aaaa1111\n---\n\nA general question.',
    );
    await call(app.port, post(app.origin, '/api/chat', { q: '2026-11-26T100000Z-aaaa1111-q', text: 'Answer.' }));
    expect(oneCard(app.board, card.id).column).toBe('doing');
    await app.close();
  });
});

// Карточка 141 (UD-47): один порт. Публичный доступ включается и выключается на работающем сервере
// командой CLI — через токен управления; странице токена нет.
describe('режим доступа на одном порту', () => {
  const mode = (port: number, token: string | undefined, body: object): Promise<Reply> =>
    call(port, {
      method: 'POST',
      path: '/api/mode',
      headers: {
        'Content-Type': 'application/json',
        ...(token === undefined ? {} : { Authorization: `Control ${token}` }),
      },
      body: JSON.stringify(body),
    });

  it('включить и выключить может только управляющий процесс; выключить — только зная пароль', async () => {
    let token = '';
    const app = await boot({ onControl: (t: string) => (token = t) });
    expect((await mode(app.port, undefined, { public: true, password: 'pw' })).status).toBe(403);
    expect((await mode(app.port, 'not-the-token', { public: true, password: 'pw' })).status).toBe(403);
    expect((await mode(app.port, token, { public: true, password: '' })).status).toBe(400);
    expect((await call(app.port, { path: '/api/state' })).status).toBe(200);

    expect((await mode(app.port, token, { public: true, password: 'pw' })).status).toBe(200);
    // публично: пароль нужен всем, включая localhost; чужой Host больше не барьер — доступ защищает пароль
    expect((await call(app.port, { path: '/api/state' })).status).toBe(401);
    expect((await call(app.port, { headers: { Host: 'evil.example' }, path: '/api/state' })).status).toBe(401);
    const login = await call(app.port, post(app.origin, '/api/login', { password: 'pw' }));
    expect(login.status).toBe(200);
    expect(login.cookie).toContain('Secure');
    const auth = { Cookie: login.cookie ?? '' };
    expect((await call(app.port, { path: '/api/state', headers: auth })).status).toBe(200);
    expect((await call(app.port, post('http://evil.example', '/api/card', {}, auth))).status).toBe(403);

    expect((await mode(app.port, token, { public: false, password: 'nope' })).status).toBe(401);
    expect((await call(app.port, { path: '/api/state' })).status).toBe(401);
    expect((await mode(app.port, token, { public: false, password: 'pw' })).status).toBe(200);
    expect((await call(app.port, { path: '/api/state' })).status).toBe(200);
    expect((await call(app.port, { headers: { Host: 'evil.example' }, path: '/api/state' })).status).toBe(403);
    await app.close();
  });

  it('в публичном режиме страница без токена не выключает доступ; Origin чужой — 403', async () => {
    let token = '';
    const app = await boot({ onControl: (t: string) => (token = t) });
    await mode(app.port, token, { public: true, password: 'pw' });
    expect((await call(app.port, post(app.origin, '/api/mode', { public: false, password: 'pw' }))).status).toBe(403);
    expect((await call(app.port, { path: '/api/state' })).status).toBe(401);
    await app.close();
  });
});
