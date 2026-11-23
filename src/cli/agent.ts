// Команды агента-исполнителя и проверяющего: один шаг протокола — одна команда.
// Каждая команда оставляет доску целостной: лок, запись, колонка — вместе или ничего.

import { join } from 'node:path';
import { listCards, oneCard, readColumns, readEntries } from '../core/board.js';
import { Fail } from '../core/errors.js';
import { readText } from '../core/fs.js';
import { newSessionTag } from '../core/names.js';
import { ask, claim, note, verdictFail, verdictPass, readyForReview } from '../core/ops.js';
import { toPosix } from '../core/paths.js';
import type { Card } from '../core/types.js';
import { flag, type Args } from './args.js';
import { need, requireBoard, requireSession, textArg } from './context.js';
import { say } from './io.js';

/** `viboard session` — новый тег сессии (или $VIBOARD_SESSION, если среда его задаёт). */
export function cmdSession(): number {
  say(newSessionTag());
  return 0;
}

/** `viboard ls [колонка]` — вся доска в по одной строке на карточку. */
export function cmdLs(args: Args): number {
  const board = requireBoard(args);
  const only = args.positional[1];
  const columns = readColumns(board);
  if (only !== undefined && !columns.includes(only)) {
    throw new Fail(`no column «${only}»; columns: ${columns.join(', ')}`);
  }
  const cards = listCards(board);
  const idWidth = Math.max(4, ...cards.map((c) => c.id.length)) + 2;
  const projectWidth = Math.min(26, Math.max(4, ...cards.map((c) => c.project.length))) + 2;
  for (const column of columns) {
    if (only !== undefined && column !== only) continue;
    const here = cards.filter((c) => c.column === column);
    say(`${column} (${here.length})`);
    for (const c of here) {
      const lock = c.lockedBy ? `lock-${c.lockedBy}  ` : '';
      say(`  P${c.priority}  ${c.id.padEnd(idWidth)}${c.project.padEnd(projectWidth)}${lock}${c.title}`);
    }
  }
  return 0;
}

/** `viboard show <id> [--log]` — карточка: путь, README целиком, имена записей (с --log — их текст). */
export function cmdShow(args: Args): number {
  const board = requireBoard(args);
  const card = oneCard(board, need(args.positional[1], 'card id'));
  say(`${card.name} · ${card.column}/`);
  say(toPosix(card.dir));
  say('');
  say(readText(join(card.dir, 'README.md')) ?? '');
  if (card.lockedBy) say(`\nheld by lock-${card.lockedBy}`);
  if (card.assets.length > 0) say(`\nassets: ${card.assets.join(', ')}`);
  const entries = readEntries(card);
  say(`\nlog (${entries.length}):`);
  for (const e of entries) {
    say(`  ${e.file}`);
    if (flag(args, 'log')) say(e.text.replace(/\n/gu, '\n    '));
  }
  return 0;
}

/** `viboard find <id|фрагмент>` — путь к карточке (путь не кэшируется: колонка могла смениться). */
export function cmdFind(args: Args): number {
  const board = requireBoard(args);
  const ref = need(args.positional[1], 'card id or name fragment');
  const hits = listCards(board).filter((c) => c.id === ref || c.name.includes(ref) || c.id.includes(ref));
  if (hits.length === 0) throw new Fail(`nothing matches «${ref}» — viboard ls lists the board`);
  for (const c of hits) say(toPosix(c.dir));
  return 0;
}

const moved = (card: Card): void => say(`${card.name} → ${card.column}/`);

/** `viboard claim <id>` — lock → запись → doing/. */
export function cmdClaim(args: Args): number {
  const tag = requireSession(args);
  const card = claim(requireBoard(args), need(args.positional[1], 'card id'), tag, { force: flag(args, 'force') });
  moved(card);
  say(`lock-${tag}`);
  return 0;
}

/** `viboard note <id> <текст | --file F>` — запись в log/ карточки. */
export function cmdNote(args: Args): number {
  const board = requireBoard(args);
  const ref = need(args.positional[1], 'card id');
  say(`log/${note(board, ref, requireSession(args), textArg(args, 2, 'note text'))}`);
  return 0;
}

/** `viboard ask <id> <вопрос | --file F>` — тред в questions/, запись, blocked/. */
export function cmdAsk(args: Args): number {
  const board = requireBoard(args);
  const ref = need(args.positional[1], 'card id');
  const { card, thread } = ask(board, ref, requireSession(args), textArg(args, 2, 'question'));
  say(`questions/${thread}/`);
  moved(card);
  return 0;
}

/** `viboard review <id> <what was done and how it was verified | --file F>` — готово к проверке. */
export function cmdReview(args: Args): number {
  const board = requireBoard(args);
  const ref = need(args.positional[1], 'card id');
  moved(readyForReview(board, ref, requireSession(args), textArg(args, 2, 'what was done and how it was verified')));
  return 0;
}

/** `viboard pass <id> [чем подтверждено]` — вердикт проверяющего: done/. */
export function cmdPass(args: Args): number {
  const board = requireBoard(args);
  const ref = need(args.positional[1], 'card id');
  const text = args.positional.slice(2).join(' ');
  moved(verdictPass(board, ref, requireSession(args), text));
  return 0;
}

/** `viboard fail <id> <находка | --file F>` — вердикт проверяющего: возврат в doing/. */
export function cmdFail(args: Args): number {
  const board = requireBoard(args);
  const ref = need(args.positional[1], 'card id');
  moved(verdictFail(board, ref, requireSession(args), textArg(args, 2, 'finding')));
  return 0;
}
