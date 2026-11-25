// Тексты заданий для новых сессий — единственный источник: их печатает `viboard prompt`
// и их же отдаёт UI («Агент»). Доска агент-агностична (А5): как доставить текст сессии — решает среда.
// Тексты — на английском: это публичный артефакт (UD-27), английский дешевле в токенах.

import { toPosix } from './paths.js';
import type { Card, PromptName, Role } from './types.js';

export type { PromptName };

export interface PromptContext {
  /** Корень доски (абсолютный путь). */
  board: string;
  /** Команда CLI для агента: `viboard`, `npx viboard` или путь к исполняемому файлу. */
  cli: string;
}

const lines = (...xs: string[]): string => xs.join('\n');

/** Адрес доски для промпта: пути всегда с «/» — читается одинаково в PowerShell, bash и cmd. */
export function boardLine(board: string): string {
  const b = toPosix(board);
  return `viboard task board: ${b}. Read ${b}/AGENTS.md in full and follow it.`;
}

const identity = (tag: string): string => `Your session tag: ${tag} — pass it to every command (--session ${tag}).`;

function executorPrompt(ctx: PromptContext, card: Card | null, tag: string): string {
  const head = ['You are an executor on the viboard file-based task board.', boardLine(ctx.board), identity(tag)];
  const finish = (id: string): string[] => [
    `${ctx.cli} claim ${id} → do the work → ${ctx.cli} review ${id} "<what was done and how it was verified>".`,
    `Need the owner's answer — ${ctx.cli} ask ${id}: the thread is the only channel; the whole question is its text, never a file in the card. Never rewrite the task.`,
  ];
  if (!card) {
    return lines(
      ...head,
      `Take the top free card in todo/: ${ctx.cli} ls todo → ${ctx.cli} claim <id>.`,
      ...finish('<id>'),
    );
  }
  const where = ` (project ${card.project}, P${card.priority})`;
  return lines(...head, `Card: ${card.id} — "${card.title}"${where}.`, ...finish(card.id));
}

function reviewerPrompt(ctx: PromptContext, card: Card | null, tag: string): string {
  const head = [
    'You are a reviewer on the viboard file-based task board.',
    boardLine(ctx.board),
    `Then read ${toPosix(ctx.board)}/reviewer.md.`,
    identity(tag),
  ];
  const verdicts = `Verdict: ${ctx.cli} pass <id> "<how it was confirmed>" or ${ctx.cli} fail <id> "<finding>".`;
  const check = 'Check the result against the task text and the executor entries in the card log/.';
  if (!card) {
    return lines(...head, `Take a card in review/ that has no verdict (${ctx.cli} check lists them).`, check, verdicts);
  }
  return lines(...head, `Card: ${card.id} — "${card.title}".`, check, verdicts);
}

function managerPrompt(ctx: PromptContext, _card: Card | null, tag: string): string {
  return lines(
    'You are the manager of the viboard file-based task board.',
    boardLine(ctx.board),
    `Then read ${toPosix(ctx.board)}/manager.md.`,
    identity(tag),
    `The pass: ${ctx.cli} check → resolve every finding as manager.md describes → questions to the owner as one batch, in the chat of your environment.`,
    'Only the manager commits the board, at the end of the pass — when the automatic git sync of the board is off.',
  );
}

/** Тексты для UI: карточка не указана, тег — заглушка (сессия выберет свой). */
export function promptSet(ctx: PromptContext): Record<PromptName, string> {
  const tag = '<tag>';
  return {
    board: boardLine(ctx.board),
    executor: executorPrompt(ctx, null, tag),
    reviewer: reviewerPrompt(ctx, null, tag),
    manager: managerPrompt(ctx, null, tag),
  };
}

export type { Role };
export type RolePrompt = (ctx: PromptContext, card: Card | null, tag: string) => string;

export const prompts: Record<Role, RolePrompt> = {
  executor: executorPrompt,
  reviewer: reviewerPrompt,
  manager: managerPrompt,
};
