// Минимальный YAML-фронматтер README и записей: скаляры и списки строк.
// Нетронутые поля воспроизводятся дословно (raw) — правка одного ключа не теряет остальное.

export type FieldValue = string | string[];

export interface Field {
  key: string;
  /** Строки «key: …» как есть, включая блок списка/скаляра. */
  raw: string;
  value: FieldValue;
}

export interface Doc {
  fields: Field[];
  body: string;
}

/** Пустой документ — для новых файлов (карточка, запись, тред). */
export const emptyDoc = (): Doc => ({ fields: [], body: '' });

const KEY_RE = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/;
const BLOCK_SCALAR = /^[|>][-+]?$/;
const ITEM_RE = /^\s*-\s+(.*)$/;

/** Значение без кавычек; `"…"` читается как JSON-строка (так же оно и пишется). */
export function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      const v: unknown = JSON.parse(t);
      if (typeof v === 'string') return v;
    } catch {
      /* не JSON — вернём как есть */
    }
    return t.slice(1, -1);
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t.replace(/\s+#.*$/u, '');
}

function splitInline(s: string): string[] {
  const items: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      items.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() !== '') items.push(cur.trim());
  return items.filter((i) => i !== '').map(unquote);
}

export function parseDoc(raw: string): Doc {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trimEnd() !== '---') return { fields: [], body: raw.trim() };
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
  if (end < 0) return { fields: [], body: raw.trim() };

  const fields: Field[] = [];
  let i = 1;
  while (i < end) {
    const line = lines[i++] ?? '';
    const m = KEY_RE.exec(line);
    if (!m?.[1]) {
      // не «key: value» (комментарий, пустая строка, чужая структура) — сохраняем дословно на своём месте
      fields.push({ key: `#${i}`, raw: line, value: '' });
      continue;
    }
    const value = (m[2] ?? '').trim();
    const rawLines = [line];
    let parsed: FieldValue;
    if (BLOCK_SCALAR.test(value)) {
      const block: string[] = [];
      while (i < end && /^\s+\S|^\s*$/.test(lines[i] ?? '')) {
        block.push((lines[i] ?? '').replace(/^\s+/, ''));
        rawLines.push(lines[i] ?? '');
        i++;
      }
      parsed = block.join(value.startsWith('>') ? ' ' : '\n').trim();
    } else if (value === '') {
      const items: string[] = [];
      while (i < end && ITEM_RE.test(lines[i] ?? '')) {
        const item = ITEM_RE.exec(lines[i] ?? '');
        items.push(unquote(item?.[1] ?? ''));
        rawLines.push(lines[i] ?? '');
        i++;
      }
      parsed = items;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      parsed = splitInline(value.slice(1, -1));
    } else {
      parsed = unquote(value);
    }
    fields.push({ key: m[1], raw: rawLines.join('\n'), value: parsed });
  }
  return {
    fields,
    body: lines
      .slice(end + 1)
      .join('\n')
      .trim(),
  };
}

const plainSafe = (s: string): boolean =>
  s.length > 0 &&
  s === s.trim() &&
  !/^[-?:,[\]{}#&*!|>'"%@`]/u.test(s) &&
  !/(:\s|\s#)/u.test(s) &&
  !/[\p{Cc}\t]/u.test(s) &&
  !/^(?:~|null|true|false|yes|no|on|off)$/iu.test(s) &&
  !/^[\d.]+(?:[eE][+-]?\d+)?$/u.test(s) &&
  !/^\d{4}-\d{2}-\d{2}/u.test(s);

/** Скаляр в YAML: без кавычек, когда это безопасно, иначе JSON-строка (валидный YAML в двойных кавычках). */
export const scalar = (s: string): string => (plainSafe(s) ? s : JSON.stringify(s));

const formatValue = (v: FieldValue | number): string => {
  if (typeof v === 'number') return String(v);
  if (!Array.isArray(v)) return scalar(v);
  const bare = /^[^,[\]{}#&*!|>'"%@`]*$/u;
  const items = v.map((i) => (bare.test(i) ? scalar(i) : JSON.stringify(i)));
  return `[${items.join(', ')}]`;
};

/** Текст документа: поля в прежнем порядке; `patch` заменяет/добавляет ключи, undefined — удаляет. */
export function formatDoc(
  doc: Doc,
  patch: Record<string, FieldValue | number | undefined>,
  body: string = doc.body,
): string {
  const lines: string[] = ['---'];
  const seen = new Set<string>();
  for (const f of doc.fields) {
    if (f.key in patch) {
      const v = patch[f.key];
      if (v !== undefined) lines.push(`${f.key}: ${formatValue(v)}`);
      seen.add(f.key);
    } else lines.push(f.raw);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (!seen.has(k) && v !== undefined) lines.push(`${k}: ${formatValue(v)}`);
  }
  const text = body.trim();
  return `${lines.join('\n')}\n---\n\n${text}\n`;
}

const field = (doc: Doc, key: string): Field | undefined => doc.fields.find((f) => f.key === key);

export const metaStr = (doc: Doc, key: string, fallback = ''): string => {
  const v = field(doc, key)?.value;
  return typeof v === 'string' && v !== '' ? v : Array.isArray(v) && v.length > 0 ? String(v[0]) : fallback;
};

export const metaList = (doc: Doc, key: string): string[] => {
  const v = field(doc, key)?.value;
  if (Array.isArray(v)) return v.filter((i) => i !== '');
  return typeof v === 'string' && v !== '' ? [v] : [];
};

export const metaInt = (doc: Doc, key: string, fallback: number): number => {
  const n = Number(metaStr(doc, key));
  return Number.isFinite(n) ? n : fallback;
};
