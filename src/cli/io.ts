// Вывод CLI: человек читает, агент разбирает глазами. Один префикс ошибок, без цветов и таблиц-ASCII-арта.

export const say = (line = ''): void => {
  console.log(line);
};

export const sayError = (line: string): void => {
  console.error(`viboard: ${line}`);
};

/** Первая строка текста, обрезанная до `max` — для списков. */
export function firstLine(text: string, max = 80): string {
  const line = text.split('\n')[0]?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** `2026-11-23T183001Z` → локальные дата и время. */
export function localTime(stamp: string): string {
  const d = new Date(`${stamp.slice(0, 10)}T${stamp.slice(11, 13)}:${stamp.slice(13, 15)}:${stamp.slice(15, 17)}Z`);
  if (Number.isNaN(d.getTime())) return stamp;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
