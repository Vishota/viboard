// Markdown для текстов агентов: заголовки, списки, цитаты, код, таблицы, ссылки.
// Безопасно по построению: весь текст экранируется, разметка строится поверх экранированного,
// ссылками становятся только http(s) и mailto.

const ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/gu, (c) => ESCAPE[c] ?? c);

const SAFE_URL = /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+)$/iu;

/** Маркер стопки готовых фрагментов: символ закрытой области Unicode, в текстах не встречается. */
const MARK = '\uE000';
const UNMARK = new RegExp(`${MARK}(\\d+)${MARK}`, 'gu');

/** Готовые фрагменты HTML прячутся в стопку, чтобы дальнейшие правила не трогали их содержимое. */
interface Stash {
  html: string[];
}

const stash = (s: Stash, html: string): string => `${MARK}${s.html.push(html) - 1}${MARK}`;

const restore = (s: Stash, html: string): string =>
  html.replace(UNMARK, (_match, index: string) => s.html[Number(index)] ?? '');

const anchor = (url: string, label: string): string =>
  `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;

/** Адреса распознаются на сыром тексте — до экранирования, чтобы не экранировать их дважды. */
function linkify(raw: string, s: Stash): string {
  return raw
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/gu, (match, label: string, url: string) =>
      SAFE_URL.test(url) ? stash(s, anchor(url, escapeHtml(label))) : match,
    )
    .replace(/(^|[\s(])(https?:\/\/[^\s<)"']+)/gu, (_match, before: string, url: string) =>
      stash(s, `${before}${anchor(url, escapeHtml(url))}`),
    );
}

/** Жирный и курсив — уже на экранированном тексте. */
const emphasis = (escaped: string): string =>
  escaped
    .replace(/\*\*([^*\n]+)\*\*/gu, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu, '<em>$1</em>')
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/gu, '<em>$1</em>');

/** Строка без блочной структуры: код, ссылки, жирный, курсив. */
function inline(raw: string, s: Stash): string {
  return raw
    .split(/(`[^`\n]+`)/u)
    .map((part, i) => {
      // код — первым: разметка и ссылки не действуют внутри `…`
      if (i % 2 === 1) return stash(s, `<code>${escapeHtml(part.slice(1, -1))}</code>`);
      return emphasis(escapeHtml(linkify(part, s)));
    })
    .join('');
}

const cells = (row: string): string[] =>
  row
    .replace(/^\||\|$/gu, '')
    .split('|')
    .map((c) => c.trim());

/** Превращает markdown в безопасный HTML (результат пригоден для v-html). */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  const s: Stash = { html: [] };
  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length === 0) return;
    out.push(`<p>${paragraph.map((l) => inline(l, s)).join('<br>')}</p>`);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flush();
      const code: string[] = [];
      while (i + 1 < lines.length && !(lines[i + 1] ?? '').trim().startsWith('```')) {
        code.push(lines[++i] ?? '');
      }
      i += 1; // закрывающий ```
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(trimmed);
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      flush();
      const level = Math.min(6, heading[1].length + 1); // # во внешнем тексте — не h1 страницы
      out.push(`<h${level}>${inline(heading[2], s)}</h${level}>`);
      continue;
    }
    if (/^(?:-{3,}|\*{3,})$/u.test(trimmed)) {
      flush();
      out.push('<hr>');
      continue;
    }
    if (/^>\s?/u.test(trimmed)) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/u.test((lines[i] ?? '').trim())) {
        quote.push((lines[i] ?? '').trim().replace(/^>\s?/u, ''));
        i += 1;
      }
      i -= 1;
      out.push(`<blockquote>${quote.map((q) => `<p>${inline(q, s)}</p>`).join('')}</blockquote>`);
      continue;
    }
    const ordered = /^\d+[.)]\s/u.test(trimmed);
    if (ordered || /^[-*+]\s/u.test(trimmed)) {
      flush();
      const item = ordered ? /^\d+[.)]\s+(.*)$/u : /^[-*+]\s+(.*)$/u;
      const items: string[] = [];
      while (i < lines.length) {
        const match = item.exec((lines[i] ?? '').trim());
        if (!match) break;
        items.push(match[1] ?? '');
        i += 1;
      }
      i -= 1;
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((text) => `<li>${inline(text, s)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const next = (lines[i + 1] ?? '').trim();
    if (trimmed.startsWith('|') && /^\|?\s*:?-{2,}/u.test(next)) {
      flush();
      const head = cells(trimmed);
      i += 2; // строка-разделитель
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        rows.push(cells((lines[i] ?? '').trim()));
        i += 1;
      }
      i -= 1;
      const th = head.map((c) => `<th>${inline(c, s)}</th>`).join('');
      const tr = rows
        .map((row) => `<tr>${head.map((_h, n) => `<td>${inline(row[n] ?? '', s)}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`);
      continue;
    }
    if (trimmed === '') {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return restore(s, out.join('\n'));
}
