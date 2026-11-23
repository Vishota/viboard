// viboard — точка входа CLI. Одна команда — один шаг протокола; вывод читается человеком и агентом.

import { isBoard, resolveBoard } from '../core/board.js';
import { VERSION } from '../core/version.js';
import { option, parseArgs, type Args } from './args.js';
import {
  cmdAsk,
  cmdClaim,
  cmdFail,
  cmdFind,
  cmdLs,
  cmdNote,
  cmdPass,
  cmdReview,
  cmdSession,
  cmdShow,
} from './agent.js';
import { Fail } from '../core/errors.js';
import { cmdCardAdd, cmdCheck, cmdFix, cmdLog, cmdMv, cmdPrompt, cmdShell, cmdStamp, cmdUnblock } from './manage.js';
import { cmdInit, cmdUi } from './setup.js';
import { say, sayError } from './io.js';

const USAGE = `viboard ${VERSION} — file-based task board: Trello for the owner, ls and cat for an agent

Start
  viboard                              no board — creates one and opens the UI; otherwise opens the UI
  viboard init [--here | --board <path>] [--project <name>] [--update-protocol] [--no-git]
  viboard ui [--port 8777] [--no-open] [--password <password> [--public]]

Agent   (board: --board <path> → $VIBOARD_BOARD → ./board → ~/.viboard/board; tag: --session or $VIBOARD_SESSION)
  viboard session                          new session tag
  viboard ls [column]                      cards: P · id · project · lock · title
  viboard show <id> [--log]                card: path, README, log entries
  viboard find <id|fragment>               path to the card
  viboard claim <id> [--force]             take it: lock → entry → doing/
  viboard note <id> <text | --file F>      entry in the card log/
  viboard ask <id> <question | --file F>   ask the owner: thread + blocked/
  viboard review <id> <text | --file F>    done, ready for review: entry + review/
  viboard pass <id> [text]                 verdict: done/ + entry in the board log/
  viboard fail <id> <finding | --file F>   verdict: back to doing/

Manager
  viboard check                            the pass checklist; exit code 1 — there are warnings
  viboard fix                              card names ← frontmatter
  viboard mv <id> <column> [--force]       move (a locked card — only with --force)
  viboard unblock <id>                     blocked/ → doing/ (has a lock) or todo/
  viboard log [N]                          feed: decisions, questions, verdicts, done
  viboard prompt [id] [--role R]           briefing for a new session: executor | reviewer | manager

By hand
  viboard card add --project <id> --title "<title>" [--body "<text>" | --body-file F] [--priority 1-5] [--column C]
  viboard stamp --session <tag> --card <id|-> --kind <type> [--dir <directory>]
  viboard shell                            shell commands for your OS`;

type Handler = (args: Args) => number | Promise<number>;

const COMMANDS: Record<string, Handler> = {
  init: (args) => cmdInit(args, false),
  ui: (args) => cmdUi(args),
  session: cmdSession,
  ls: cmdLs,
  show: cmdShow,
  find: cmdFind,
  claim: cmdClaim,
  note: cmdNote,
  ask: cmdAsk,
  review: cmdReview,
  pass: cmdPass,
  fail: cmdFail,
  check: cmdCheck,
  fix: cmdFix,
  mv: cmdMv,
  unblock: cmdUnblock,
  log: cmdLog,
  prompt: cmdPrompt,
  shell: () => cmdShell(),
  stamp: cmdStamp,
  card: cmdCardAdd,
};

/** Запуск без команды: есть доска — UI; нет — init и сразу UI. */
async function runDefault(args: Args): Promise<number> {
  const board = resolveBoard(option(args, 'board'));
  return isBoard(board) ? cmdUi(args, board) : cmdInit(args, true);
}

/** Ответ без доски и без команды: версия и справка — флагом (`--version`, `--help`) или словом (`-v`, `help`, `-h`). */
export function instant(args: Args): string | null {
  const first = args.positional[0];
  if (args.flags.version !== undefined || first === '-v') return VERSION;
  if (args.flags.help !== undefined || first === 'help' || first === '-h') return USAGE;
  return null;
}

export async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  const verb = args.positional[0];
  try {
    // до разбора команды: `viboard --help` не должен запускать интерфейс (баг найден при публикации)
    const answer = instant(args);
    if (answer !== null) return say(answer);
    if (verb === undefined) {
      process.exitCode = await runDefault(args);
      return;
    }
    const handler = COMMANDS[verb];
    if (!handler) throw new Fail(`unknown command «${verb}»\n\n${USAGE}`);
    process.exitCode = await handler(args);
  } catch (e) {
    process.exitCode = 1;
    sayError(e instanceof Error ? e.message : String(e));
    if (!(e instanceof Fail)) sayError(e instanceof Error ? (e.stack ?? '') : '');
  }
}
