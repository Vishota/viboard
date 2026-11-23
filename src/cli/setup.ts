// Запуск: `viboard` — нет доски, создаст и откроет UI; есть — откроет UI. Повторный вызов не плодит серверы.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_COLUMNS, ENV_BOARD, defaultBoard } from '../core/board.js';
import { APP } from '../core/names.js';
import { PROTOCOL_DIR, toPosix } from '../core/paths.js';
import { clearRun, openBrowser, probe, readRun, writeRun } from '../core/run.js';
import { initBoard, projectFromDir } from '../core/setup.js';
import { VERSION } from '../core/version.js';
import { readText, writeAtomic } from '../core/fs.js';
import { startServer } from '../server/server.js';
import { flag, option, type Args } from './args.js';
import { requireBoard } from './context.js';
import { say } from './io.js';
import { cliCommand } from './manage.js';

const ENV_PASSWORD = `${APP}_PASSWORD`.toUpperCase();
const ENV_DEV_ORIGIN = `${APP}_DEV_ORIGIN`.toUpperCase();

const heading = (): void => say(`${APP} ${VERSION} · node ${process.version}`);

const POINTER_MARK = 'board/AGENTS.md';

/** `viboard init --here`: указатель в инструкциях проекта — агент узнаёт о доске без подсказки владельца. */
export function linkProjectAgents(project: string, cli: string): boolean {
  const existing = ['AGENTS.md', 'agents.md', 'CLAUDE.md'].find((name) => existsSync(join(project, name)));
  const file = join(project, existing ?? 'AGENTS.md');
  const current = readText(file)?.trimEnd() ?? '';
  if (current.includes(POINTER_MARK)) return false;
  const block = [
    '## Task board',
    '',
    'The task board lives in `board/` in this project. Whenever I ask you to take a card from the board, look at it or report on it,',
    `read \`board/AGENTS.md\` in full and follow it. CLI: \`${cli}\`.`,
    '',
  ].join('\n');
  writeAtomic(file, current === '' ? block : `${current}\n\n${block}`);
  return true;
}

/** `viboard init [--here | --board <путь>]`: доска, проекты, протокол, git. */
export async function cmdInit(args: Args, thenUi: boolean): Promise<number> {
  const explicit = option(args, 'board');
  const env = process.env[ENV_BOARD]?.trim();
  const here = flag(args, 'here');
  const target = here
    ? resolve('board')
    : explicit !== undefined
      ? resolve(explicit)
      : env !== undefined && env !== ''
        ? resolve(env)
        : defaultBoard();
  const result = await initBoard({
    board: target,
    project: projectFromDir(process.cwd(), option(args, 'project')),
    protocolDir: PROTOCOL_DIR,
    version: VERSION,
    updateProtocol: flag(args, 'update-protocol'),
    noGit: flag(args, 'no-git'),
  });
  const linked = here && linkProjectAgents(process.cwd(), cliCommand(args));
  heading();
  say(`board   ${toPosix(result.board)} — ${result.created ? 'created' : 'already exists'}`);
  say(`  columns: ${DEFAULT_COLUMNS.join(', ')}`);
  if (result.protocol.length > 0) say(`  protocol: ${result.protocol.join(', ')}`);
  if (result.git) say('  git: repository created');
  if (linked) say('  project AGENTS.md: link to the board added');
  if (thenUi) return cmdUi(args, result.board);
  say('next: viboard ui   →  http://127.0.0.1:8777');
  return 0;
}

/** `viboard ui`: локальный интерфейс. Уже запущено — просто открывает браузер; иначе сервер живёт до Ctrl+C. */
export async function cmdUi(args: Args, knownBoard?: string): Promise<number> {
  const board = knownBoard ?? requireBoard(args);
  const open = !flag(args, 'no-open');
  heading();
  say(`board   ${toPosix(board)}`);

  const running = readRun(board);
  if (running && (await probe(running))) {
    const url = `http://127.0.0.1:${running.port}`;
    if (open) openBrowser(url);
    say(`ui      ${url} — already running${open ? ', opened in the browser' : ''}`);
    return 0;
  }

  const password = option(args, 'password') ?? process.env[ENV_PASSWORD] ?? '';
  const publicAccess = flag(args, 'public');
  const requested = Number(option(args, 'port'));
  const devOrigin = option(args, 'dev-origin') ?? process.env[ENV_DEV_ORIGIN];
  const server = await startServer({
    board,
    port: Number.isInteger(requested) && requested > 0 ? requested : 8777,
    password: password === '' ? undefined : password,
    publicAccess,
    devOrigins: devOrigin === undefined ? [] : [devOrigin],
  });
  writeRun(board, {
    app: APP,
    port: server.port,
    pid: process.pid,
    board,
    startedAt: new Date().toISOString(),
  });
  process.on('exit', () => clearRun(board));

  if (open) openBrowser(server.url);
  say(`ui      ${server.url}${open ? ' — opened in the browser' : ''}`);
  say(`access  ${password === '' ? 'localhost, no password' : `password${publicAccess ? ', public access' : ''}`}`);
  say(`agents  ${toPosix(board)}/AGENTS.md`);
  return new Promise<number>(() => {});
}
