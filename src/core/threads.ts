// Треды чата (questions/): папка = разговор владельца с агентами.
// README.md — первое сообщение агента; answer.md — первый ответ владельца (дословно, не редактируется);
// <время>-<тег>-msg.md — сообщения; <время>-<тег>-att-<имя> — вложения (в чате = сообщения-вложения).
// Порядок в треде — время в именах файлов; записи одной сессии не делят секунду, ответ не делит её с записями.

import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { Fail } from './errors.js';
import { listDirs, listFiles, mtimeMs, readText, writeAtomic } from './fs.js';
import { emptyDoc, formatDoc, metaStr, parseDoc } from './frontmatter.js';
import { ATT_RE, LEGACY_OWNER, MSG_RE, OWNER, displayTag, stamp, stampDate, utcStamp } from './names.js';
import { requireText, safeFilename, saveAsset } from './ops.js';
import type { Message, Side, Thread } from './types.js';

/** Чтение снисходительнее записи: старые треды с длинными id сессий (`sess_…`) тоже показываются. */
const THREAD_READ_RE = /^(\d{4}-\d{2}-\d{2}T\d{6}Z)-(.+?)-(\d{3,}-[a-z0-9-]+|-)-q$/u;

const sideOf = (tag: string): Side => (tag === OWNER || tag === LEGACY_OWNER ? 'user' : 'agent');
const ownerTag = (tag: string): string => (tag === LEGACY_OWNER ? OWNER : tag);

/** Секунда answer.md (его mtime): записи треда её не занимают — порядок остаётся однозначным. */
function answeredSecond(path: string): number | null {
  const ms = mtimeMs(join(path, 'answer.md'));
  return ms === null ? null : Math.floor(ms / 1000) * 1000;
}

const avoidAnswer =
  (path: string): ((utc: string) => boolean) =>
  (utc) => {
    const ms = answeredSecond(path);
    return ms !== null && utcStamp(new Date(ms)) === utc;
  };

export function threadPath(board: string, dir: string): string {
  if (!THREAD_READ_RE.test(dir)) throw new Fail('invalid thread name');
  return join(board, 'questions', dir);
}

export function listThreads(board: string): Thread[] {
  const root = join(board, 'questions');
  const out: Thread[] = [];
  for (const dir of listDirs(root)) {
    const m = THREAD_READ_RE.exec(dir);
    if (!m?.[1] || !m[2] || m[3] === undefined) continue;
    const path = join(root, dir);
    const readme = readText(join(path, 'README.md'));
    if (readme === null) continue;
    const first = parseDoc(readme);
    const messages: Message[] = [
      {
        side: 'agent',
        session: displayTag(metaStr(first, 'from', m[2])),
        time: stampDate(m[1]).getTime(),
        body: first.body,
        attachment: null,
      },
    ];
    const answer = readText(join(path, 'answer.md'));
    if (answer !== null) {
      messages.push({
        side: 'user',
        session: OWNER,
        time: answeredSecond(path),
        body: answer.trim(),
        attachment: null,
      });
    }
    for (const file of listFiles(path)) {
      if (file === 'README.md' || file === 'answer.md') continue;
      const msg = MSG_RE.exec(file);
      if (msg?.[1] && msg[2]) {
        const doc = parseDoc(readText(join(path, file)) ?? '');
        messages.push({
          side: metaStr(doc, 'from') === 'user' ? 'user' : 'agent',
          session: displayTag(metaStr(doc, 'session', msg[2])),
          time: stampDate(msg[1]).getTime(),
          body: doc.body,
          attachment: null,
        });
        continue;
      }
      const att = ATT_RE.exec(file);
      if (att?.[1] && att[2] && att[3]) {
        messages.push({
          side: sideOf(att[2]),
          session: ownerTag(att[2]),
          time: stampDate(att[1]).getTime(),
          body: att[3],
          attachment: file,
        });
      }
    }
    messages.sort((a, b) => (a.time ?? 0) - (b.time ?? 0)); // сортировка устойчива: равные времена — по имени
    const last = messages.at(-1);
    out.push({
      dir,
      card: m[3] === '-' ? '' : m[3],
      created: m[1],
      answered: messages.some((x) => x.side === 'user'),
      lastFrom: last?.side ?? 'agent',
      messages,
    });
  }
  return out.sort((a, b) => b.created.localeCompare(a.created));
}

/** Сообщение владельца: первое — в answer.md (дословно), дальнейшие — файлом <время>-owner-msg.md. */
export function postOwnerMessage(board: string, dir: string, text: string): string {
  const body = requireText(text, 'message');
  const path = threadPath(board, dir);
  if (readText(join(path, 'README.md')) === null) throw new Fail('thread not found');
  const answer = join(path, 'answer.md');
  if (readText(answer) === null) {
    // ответ занимает свободную секунду, как запись; его mtime — ровно эта секунда
    const reserved = stamp({ dir: path, session: OWNER, kind: 'msg', asOwner: true });
    const at = stampDate(reserved.slice(0, 18));
    writeAtomic(answer, `${body}\n`);
    try {
      utimesSync(answer, at, at);
    } catch {
      /* файловая система не даёт задать mtime — остаётся фактическое время записи, порядок в треде сохраняется */
    }
    return 'answer.md';
  }
  const token = stamp({
    dir: path,
    session: OWNER,
    kind: 'msg',
    asOwner: true,
    occupied: avoidAnswer(path),
  });
  writeAtomic(join(path, `${token}.md`), formatDoc(emptyDoc(), { from: 'user', session: OWNER }, body));
  return `${token}.md`;
}

/** Вложение владельца в тред — отдельный файл <время>-owner-att-<имя>. Возвращает имя файла. */
export function postOwnerAttachment(board: string, dir: string, filename: string, data: Buffer): string {
  const path = threadPath(board, dir);
  if (readText(join(path, 'README.md')) === null) throw new Fail('thread not found');
  const token = stamp({
    dir: path,
    session: OWNER,
    kind: 'att',
    asOwner: true,
    occupied: avoidAnswer(path),
  });
  return saveAsset(path, `${token}-${safeFilename(filename)}`, data);
}
