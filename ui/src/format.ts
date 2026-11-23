// Форматирование для интерфейса: время, размер, тип вложения.

/** `2026-11-23T184935Z` → миллисекунды. */
export function stampMs(stamp: string): number {
  const iso = stamp.replace(/^(\d{4}-\d{2}-\d{2}T)(\d{2})(\d{2})(\d{2})Z$/u, '$1$2:$3:$4Z');
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

const p2 = (n: number): string => String(n).padStart(2, '0');

/** Часы:минуты в локальном времени. */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** День.месяц часы:минуты в локальном времени. */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)} ${formatTime(ms)}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const IMAGES = /\.(png|jpe?g|gif|webp|svg)$/iu;

export const isImage = (name: string): boolean => IMAGES.test(name);

/** Имя файла без префикса <время>-<тег>-att-. */
export function attachmentName(file: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{6}Z-[a-z0-9-]+-att-(.+)$/u.exec(file)?.[1] ?? file;
}

/** Первая строка текста, обрезанная — для списка тредов. */
export function preview(text: string, max = 80): string {
  const line = text.split('\n')[0]?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
