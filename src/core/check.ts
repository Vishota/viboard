// Проход менеджера — видимость, не принуждение (аксиома А7): чек-лист протокола, вычисленный по файловой системе.
// Суждение остаётся за менеджером; здесь только факты и готовые команды.

import { renameSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expectedName, listCards, readCardDoc, readColumns, readEntries } from './board.js';
import { metaList } from './frontmatter.js';
import { isRealDir, listDirs, listFiles, movePath, readText } from './fs.js';
import { LEGACY_LOCK, LOCK, LOCK_STALE_MS, WIP_LIMIT, parseEntryName } from './names.js';
import { listThreads } from './threads.js';
import type { Finding, FindingLevel } from './types.js';

export interface CheckOptions {
  now?: Date;
  /** Версия протокола в этом пакете — с ней сравнивается протокол в доске. */
  protocolVersion: string;
}

/** Версия из первой строки протокола в доске (<!-- viboard 0.1.0 -->) либо null. */
export function installedProtocolVersion(board: string): string | null {
  const head = readText(join(board, 'AGENTS.md'))?.slice(0, 400) ?? '';
  return /<!-- viboard (\S+) -->/u.exec(head)?.[1] ?? null;
}

const hours = (ms: number): string => `${Math.floor(ms / 3600e3)}h`;

export function checkBoard(board: string, options: CheckOptions): Finding[] {
  const out: Finding[] = [];
  const add = (level: FindingLevel, text: string): void => {
    out.push({ level, text });
  };
  const now = options.now ?? new Date();
  const cards = listCards(board);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const threads = listThreads(board);
  const boardLog = listFiles(join(board, 'log'));

  const installed = installedProtocolVersion(board);
  if (installed === null) add('warn', 'the board has no AGENTS.md (protocol) — viboard init --update-protocol');
  else if (installed !== options.protocolVersion) {
    add(
      'info',
      `protocol in the board is ${installed}, in the package ${options.protocolVersion} — viboard init --update-protocol`,
    );
  }

  const held = new Map<string, string[]>();
  for (const c of cards) {
    const at = `${c.column}/${c.name}`;
    const expected = expectedName(c);
    if (expected !== c.name) add('warn', `${at}: name does not match the card — expected ${expected} (viboard fix)`);
    if (c.lockedBy !== null && isRealDir(join(c.dir, `${LEGACY_LOCK}${c.lockedBy}`))) {
      add(
        'info',
        `${at}: the lock folder uses the old name ${LEGACY_LOCK}<tag> — viboard fix renames it to ${LOCK}<tag>`,
      );
    }
    for (const dep of metaList(readCardDoc(c), 'depends_on')) {
      const d = byId.get(dep);
      if (!d) add('error', `${at}: depends_on → «${dep}» — no such card`);
      else if (d.column === 'backlog') add('warn', `${at}: depends on «${dep}», which is in backlog/`);
    }
    for (const f of c.log) {
      if (f.startsWith('.')) continue;
      const e = parseEntryName(f);
      if (!e) add('warn', `${at}/log/${f}: name is out of format${formatHint(f)}`);
      else if (e.card !== '')
        add('warn', `${at}/log/${f}: unexpected card id — only entries in the board log/ carry one`);
    }
    if (c.column === 'review' && !readEntries(c).some((e) => e.verdict === 'pass' || e.verdict === 'fail')) {
      add('info', `${at}: waiting for a reviewer → viboard prompt ${c.id} --role reviewer`);
    }
    if (
      c.column === 'done' &&
      !boardLog.some((f) => {
        const e = parseEntryName(f);
        return e?.kind === 'done' && e.card === c.id;
      })
    ) {
      add('warn', `${at}: no entry in the board log/ → viboard mv ${c.id} doing`);
    }
    if (c.column === 'blocked') {
      const own = threads.filter((t) => t.card === c.id);
      if (own.some((t) => t.answered)) add('info', `${at}: owner has answered → viboard unblock ${c.id}`);
      else if (own.length === 0) add('warn', `${at}: blocked without a thread in questions/ — reason unknown`);
    }
    if (c.column !== 'doing') continue;
    if (!c.lockedBy || c.lockedBy === '') {
      add('warn', `${at}: no lock-<tag> — the claim was never confirmed → viboard mv ${c.id} todo`);
      continue;
    }
    held.set(c.lockedBy, [...(held.get(c.lockedBy) ?? []), c.id]);
    const age = now.getTime() - (c.lockedAt ?? now.getTime());
    if (age > LOCK_STALE_MS) {
      add(
        'warn',
        `${at}: lock-${c.lockedBy} is older than ${hours(age)} — take it over (viboard claim ${c.id} --force) or ask the owner`,
      );
    }
  }
  for (const [tag, ids] of held) {
    if (ids.length <= WIP_LIMIT) continue;
    add(
      'warn',
      `WIP: session ${tag} holds ${ids.length} cards in doing/ (limit ${WIP_LIMIT}): ${ids.join(', ')} — move the extra ones: viboard mv <id> todo --force`,
    );
  }

  for (const t of threads) {
    const last = t.messages.at(-1)?.time;
    if (t.lastFrom !== 'agent' || last === undefined || last === null) continue;
    const age = now.getTime() - last;
    if (age > LOCK_STALE_MS) {
      add('warn', `questions/${t.dir}: waiting for the owner for ${hours(age)} — remind in a batch`);
    }
  }
  for (const f of boardLog) {
    if (!f.startsWith('.') && !parseEntryName(f)) add('warn', `log/${f}: name is out of format${formatHint(f)}`);
  }

  const names = new Set(cards.map((c) => c.name));
  for (const col of readColumns(board)) {
    for (const d of listDirs(join(board, col))) {
      if (!names.has(d)) add('info', `${col}/${d}: not a card — remove it from the column`);
    }
  }

  const order: Record<FindingLevel, number> = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/** Безопасные исправления: имена карточек приводятся к их frontmatter (проект, приоритет, id), старые локи — к новому имени. */
export function fixBoard(board: string): string[] {
  const done: string[] = [];
  for (const c of listCards(board)) {
    if (c.lockedBy !== null) {
      const legacy = join(c.dir, `${LEGACY_LOCK}${c.lockedBy}`);
      if (isRealDir(legacy)) {
        const current = join(c.dir, `${LOCK}${c.lockedBy}`);
        try {
          renameSync(legacy, current);
          done.push(`${c.name}: ${LEGACY_LOCK}${c.lockedBy} → ${LOCK}${c.lockedBy}`);
        } catch (e) {
          done.push(`${c.name}: lock not renamed — ${(e as Error).message}`);
        }
      }
    }
    const expected = expectedName(c);
    if (expected === c.name) continue;
    try {
      movePath(c.dir, join(board, c.column, expected));
      done.push(`${c.name} → ${expected}`);
    } catch (e) {
      done.push(`${c.name}: not renamed — ${(e as Error).message}`);
    }
  }
  // записи старого формата: тег сессии средой (`sess_<uuid>`) сжимается до первого блока uuid — детерминированно
  for (const dir of [join(board, 'log'), ...listCards(board).map((c) => join(c.dir, 'log'))]) {
    for (const file of listFiles(dir)) {
      const m = LEGACY_ENTRY.exec(file);
      if (!m?.[1] || !m[2] || !m[4]) continue;
      const to = `${m[1]}-${m[2]}-${m[3] ? `${m[3]}-` : ''}${m[4]}.md`;
      try {
        renameSync(join(dir, file), join(dir, to));
        done.push(`${relative(board, dir)}/${file} → ${to}`);
      } catch (e) {
        done.push(`${file}: not renamed — ${(e as Error).message}`);
      }
    }
  }
  return done;
}

/** Запись, написанная сессией среды в старом протоколе: время, `sess_<uuid>`, необязательный id, тип. */
const LEGACY_ENTRY =
  /^(\d{4}-\d{2}-\d{2}T\d{6}Z)-sess_([0-9a-f]{8})[0-9a-f-]*-(?:(\d{3,}-[a-z0-9-]+)-)?(note|decision|question|blocked|review|done)\.md$/u;

/** Подсказка к записи вне формата: старый формат исправим, прочее — руками. */
const formatHint = (file: string): string => (LEGACY_ENTRY.test(file) ? ' — viboard fix' : '');
