import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { listCards, readProjects } from '../../src/core/board.js';
import { createCard, editCard } from '../../src/core/ops.js';
import { PROTOCOL_DIR } from '../../src/core/paths.js';
import { setRemote, syncInfo, syncNow, writeSyncSettings } from '../../src/core/sync.js';
import { initBoard } from '../../src/core/setup.js';

// Карточка 049: git как машина состояний. Два устройства — два клона одного удалённого репозитория.

const sh = promisify(execFile);
const git = (cwd: string, ...args: string[]): Promise<string> =>
  sh('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd }).then((r) => r.stdout);

let root = '';
let remote = '';

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'viboard-sync-'));
  remote = join(root, 'remote.git');
  await git(root, 'init', '-q', '--bare', remote);
}, 30_000);
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function device(name: string, fresh = false): Promise<string> {
  const board = join(root, name);
  // второе устройство — клон удалённого репозитория; клонируем после первого push
  if (!fresh) await git(root, 'clone', '-q', remote, board);
  await initBoard({
    board,
    project: { name: 'Тест', path: root },
    protocolDir: PROTOCOL_DIR,
    version: '0.1.0-test',
    noGit: !fresh,
  });
  return board;
}

it('новая доска: git есть, origin не подключён; настройки устройства не попадают в репозиторий', async () => {
  const a = await device('a', true);
  const info = await syncInfo(a);
  expect(info).toMatchObject({ available: true, remote: '', state: 'dirty', autoPull: true, autoPush: true });
  writeSyncSettings(a, { autoPull: false });
  expect((await syncInfo(a)).autoPull).toBe(false);
  expect(await git(a, 'status', '--porcelain', '--', 'sync.json')).toBe('');
  await expect(setRemote(a, 'C:\\boards')).rejects.toThrow(/remote must look like/);
}, 30_000);

it('push одной доски, pull другой: карточка приходит на второе устройство', async () => {
  const a = await device('a', true);
  await git(a, 'remote', 'add', 'origin', remote);
  expect((await syncNow(a)).state).toBe('clean');
  const b = await device('b');
  createCard(a, { project: readProjects(a)[0]?.id ?? '', title: 'With sync', priority: 2, body: 'text' });
  expect((await syncInfo(a)).state).toBe('dirty');
  expect((await syncNow(a)).state).toBe('clean');
  expect(listCards(b)).toHaveLength(0);
  expect((await syncNow(b)).state).toBe('clean');
  expect(listCards(b).map((c) => c.title)).toEqual(['With sync']);
}, 30_000);

it('конфликт: одна карточка правлена на двух устройствах — rebase прерван, доска цела, изменения не отправлены', async () => {
  const a = await device('a', true);
  await git(a, 'remote', 'add', 'origin', remote);
  expect((await syncNow(a)).state).toBe('clean');
  createCard(a, { project: readProjects(a)[0]?.id ?? '', title: 'Same card', priority: 2, body: 'start' });
  await syncNow(a);
  const b = await device('b');
  await syncNow(b);

  editCard(a, '001', { body: 'changed on A' });
  await syncNow(a);
  editCard(b, '001', { body: 'changed on B' });
  const readme = join(b, 'todo', listCards(b)[0]?.name ?? '', 'README.md');
  const info = await syncNow(b);
  expect(info.state).toBe('conflict');
  expect(info.message).toMatch(/same files changed on two devices/);
  expect(readFileSync(readme, 'utf8')).toContain('changed on B');
  expect(readFileSync(readme, 'utf8')).not.toContain('<<<<<<<');
  expect(await git(b, 'status', '--porcelain')).not.toMatch(/^(UU|AA)/m);
  expect((await git(b, 'rev-list', '--count', '@{u}..HEAD')).trim()).toBe('1');

  // агент решил конфликт снаружи (взял версию A) — следующая попытка проходит
  await git(b, 'checkout', '@{u}', '--', '.');
  await git(b, 'add', '-A');
  await git(b, 'commit', '-q', '--amend', '--no-edit');
  expect((await syncNow(b)).state).toBe('clean');
}, 30_000);

it('недоступная сеть или чужой репозиторий: состояние error с текстом, доска работает', async () => {
  const a = await device('a', true);
  await git(a, 'remote', 'add', 'origin', 'https://invalid.invalid/x.git');
  const info = await syncNow(a);
  expect(info.state).toBe('error');
  expect(info.message).not.toBe('');
  expect(listCards(a)).toEqual([]);
}, 30_000);

it('доска внутри чужого репозитория и без git: синхронизация выключена', async () => {
  const outer = join(root, 'outer');
  await git(root, 'init', '-q', outer);
  const inner = join(outer, 'board');
  await initBoard({
    board: inner,
    project: { name: 'Тест', path: root },
    protocolDir: PROTOCOL_DIR,
    version: '0.1.0-test',
    noGit: true,
  });
  expect(await syncInfo(inner)).toMatchObject({ available: false, reason: 'inside-repo', state: 'off' });
  const bare = join(root, 'plain');
  await initBoard({
    board: bare,
    project: { name: 'Тест', path: root },
    protocolDir: PROTOCOL_DIR,
    version: '0.1.0-test',
    noGit: true,
  });
  expect(await syncInfo(bare)).toMatchObject({ available: false, reason: 'no-git', state: 'off' });
}, 30_000);
