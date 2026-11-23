// Команды менеджера, «руки владельца» из терминала и подсказки для работы без CLI.

import { resolve } from 'node:path';
import { oneCard } from '../core/board.js';
import { checkBoard, fixBoard } from '../core/check.js';
import { Fail } from '../core/errors.js';
import { readText } from '../core/fs.js';
import { APP, newSessionTag, stamp, type Kind } from '../core/names.js';
import { createCard, moveCard, unblock } from '../core/ops.js';
import { toPosix } from '../core/paths.js';
import { prompts, type PromptContext } from '../core/prompts.js';
import { shellHelp } from '../core/shell.js';
import { timeline } from '../core/timeline.js';
import { VERSION } from '../core/version.js';
import { flag, option, type Args } from './args.js';
import { need, requireBoard } from './context.js';
import { firstLine, localTime, say } from './io.js';

/** Как агенту звать CLI: из node_modules (npx, локальная установка) — `npx viboard`, иначе — `viboard`. */
export function cliCommand(args: Args): string {
  const entry = process.argv[1] ?? '';
  return option(args, 'cli') ?? process.env.VIBOARD_CLI ?? (/node_modules/iu.test(entry) ? `npx ${APP}` : APP);
}

export function cmdMv(args: Args): number {
  const board = requireBoard(args);
  const ref = need(args.positional[1], 'card id');
  const to = need(args.positional[2], 'column');
  const card = moveCard(board, ref, to, { force: flag(args, 'force'), session: option(args, 'session') });
  say(`${card.name} → ${card.column}/`);
  return 0;
}

export function cmdUnblock(args: Args): number {
  const board = requireBoard(args);
  const ref = need(args.positional[1], 'card id');
  const card = unblock(board, ref, { session: option(args, 'session') });
  say(`${card.name} → ${card.column}/`);
  return 0;
}

/** `viboard check` — чек-лист прохода менеджера, вычисленный по файловой системе. Код выхода 1 — есть замечания. */
export function cmdCheck(args: Args): number {
  const findings = checkBoard(requireBoard(args), { protocolVersion: VERSION });
  if (findings.length === 0) {
    say('ok: nothing to report');
    return 0;
  }
  const mark = { error: '!  error', warn: '!  warn ', info: '   info ' } as const;
  for (const f of findings) say(`${mark[f.level]}  ${f.text}`);
  const count = (level: string): number => findings.filter((f) => f.level === level).length;
  say(`${count('error')} errors, ${count('warn')} warnings, ${count('info')} hints`);
  return count('error') + count('warn') > 0 ? 1 : 0;
}

export function cmdFix(args: Args): number {
  const done = fixBoard(requireBoard(args));
  if (done.length === 0) say('nothing to fix: card names match');
  for (const line of done) say(line);
  return 0;
}

/** `viboard log [N]` — лента решений, вопросов, вердиктов и done (проекция записей, не отдельное хранилище). */
export function cmdLog(args: Args): number {
  const board = requireBoard(args);
  const limit = Number(args.positional[1]) || 30;
  const items = timeline(board, limit);
  if (items.length === 0) say('no events');
  for (const i of items) {
    const type = i.verdict ? `${i.type}/${i.verdict}` : i.type;
    say(`${localTime(i.time)}  ${type.padEnd(13)}${i.card.padEnd(30)}${i.tag.padEnd(10)}${firstLine(i.text, 90)}`);
  }
  return 0;
}

/** `viboard prompt [id] [--role executor|reviewer|manager]` — текст задания для новой сессии. */
export function cmdPrompt(args: Args): number {
  const board = requireBoard(args);
  const role = option(args, 'role') ?? 'executor';
  const ref = args.positional[1];
  const tag = option(args, 'session') ?? newSessionTag();
  const ctx: PromptContext = { board, cli: cliCommand(args) };
  if (role === 'manager') {
    say(prompts.manager(ctx, null, tag));
    return 0;
  }
  if (role !== 'executor' && role !== 'reviewer') {
    throw new Fail(`role must be executor, reviewer or manager; got «${role}»`);
  }
  say(prompts[role](ctx, ref === undefined ? null : oneCard(board, ref), tag));
  return 0;
}

/** `viboard card add` — карточка из терминала: для владельца или дословной передачи его слов агенту. */
export function cmdCardAdd(args: Args): number {
  const board = requireBoard(args);
  if (args.positional[1] !== 'add') {
    throw new Fail('viboard card add --project <id> --title "<title>" [--body "<text>" | --body-file <file>]');
  }
  const bodyFile = option(args, 'body-file');
  const body = bodyFile === undefined ? (option(args, 'body') ?? '') : (readText(resolve(bodyFile)) ?? '');
  const priority = option(args, 'priority');
  const card = createCard(board, {
    project: need(option(args, 'project'), '--project <project id>'),
    title: need(option(args, 'title'), '--title "<title>"'),
    body,
    priority: priority === undefined ? undefined : Number(priority),
    column: option(args, 'column'),
    slug: option(args, 'slug'),
  });
  say(`${card.name} → ${card.column}/`);
  say(toPosix(card.dir));
  return 0;
}

/** `viboard stamp` — имя записи вручную (для работы без готовых команд шагов). */
export function cmdStamp(args: Args): number {
  const card = option(args, 'card');
  say(
    stamp({
      dir: resolve(option(args, 'dir') ?? process.cwd()),
      session: need(option(args, 'session'), '--session <tag>'),
      card: card === undefined || card === '-' ? '' : card,
      kind: need(option(args, 'kind'), '--kind <type>') as Kind,
    }),
  );
  return 0;
}

export function cmdShell(): number {
  say(shellHelp());
  return 0;
}
