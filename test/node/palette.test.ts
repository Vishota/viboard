import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// patterns/ui-contrast: каждая пара «текст → фон» — не ниже WCAG 2.1 AA (4.5:1).
// Пары берутся из ui/src/style.css: новая переменная с текстом должна попасть сюда.

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../ui/src/style.css'), 'utf8');

const token = (name: string): string => {
  const value = new RegExp(`--${name}: (#[0-9a-fA-F]{6});`, 'u').exec(css)?.[1];
  if (!value) throw new Error(`в style.css нет --${name}`);
  return value;
};

/** Относительная яркость WCAG. */
function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(fore: string, back: string): number {
  const a = luminance(fore);
  const b = luminance(back);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** [текст, фон, где встречается] */
const PAIRS: ReadonlyArray<[string, string, string]> = [
  ['fg', 'bg', 'текст страницы, заголовки'],
  ['fg', 'panel', 'окна, колонки, панель чата'],
  ['fg', 'card', 'поля ввода, вторичные кнопки, сообщения агентов'],
  ['bg', 'acc', 'кнопка-акцент, P1–P2, сообщение владельца: акцент — только с тёмным текстом'],
  ['fg', 'danger', 'кнопка удаления, счётчик чата'],
  ['dim', 'bg', 'путь к доске'],
  ['dim', 'panel', 'мета карточки, счётчик в колонке'],
  ['dim', 'card', 'чипы, время в сообщении'],
  ['hint', 'card', 'плейсхолдеры полей'],
];

describe('контраст палитры — WCAG AA', () => {
  it.each(PAIRS)('%s на %s (%s)', (fore, back) => {
    expect(
      contrast(token(fore), token(back)),
      `${fore} ${token(fore)} на ${back} ${token(back)}`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('тёмная тема Vishota задана нормативными значениями', () => {
    expect(token('bg')).toBe('#171715');
    expect(token('fg')).toBe('#fffff0');
    expect(token('acc')).toBe('#ffcc00');
  });
});
