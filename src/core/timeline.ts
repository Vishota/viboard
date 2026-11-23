// Лента доски — проекция записей в карточках и в log/ доски, не отдельное хранилище:
// один факт живёт в одном месте, а «что произошло» читается командой.

import { join } from 'node:path';
import { listCards, readEntries } from './board.js';
import { parseDoc } from './frontmatter.js';
import { listFiles, readText } from './fs.js';
import { parseEntryName, type Verdict } from './names.js';

const FEED: readonly string[] = ['decision', 'question', 'blocked', 'review', 'done'];

export interface FeedItem {
  /** UTC-секунда из имени записи. */
  time: string;
  tag: string;
  type: string;
  verdict: Verdict | null;
  card: string;
  title: string;
  text: string;
}

export function timeline(board: string, limit = 30): FeedItem[] {
  const cards = listCards(board);
  const items: FeedItem[] = [];
  for (const c of cards) {
    for (const e of readEntries(c)) {
      if (FEED.includes(e.type)) {
        items.push({
          time: e.time,
          tag: e.tag,
          type: e.type,
          verdict: e.verdict,
          card: c.id,
          title: c.title,
          text: e.text,
        });
      }
    }
  }
  const byId = new Map(cards.map((c) => [c.id, c]));
  for (const f of listFiles(join(board, 'log'))) {
    const e = parseEntryName(f);
    if (!e || e.card === '') continue;
    const doc = parseDoc(readText(join(board, 'log', f)) ?? '');
    items.push({
      time: e.time,
      tag: e.tag,
      type: e.kind,
      verdict: null,
      card: e.card,
      title: byId.get(e.card)?.title ?? '',
      text: doc.body,
    });
  }
  return items
    .sort((a, b) => b.time.localeCompare(a.time) || b.card.localeCompare(a.card))
    .slice(0, Math.max(0, limit));
}
