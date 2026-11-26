import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Договор (найден перед сдачей UD-55): строки окна «Удалённый доступ» не попали в таблицу перевода,
// и в русском интерфейсе окно показало бы английский — тесты интерфейса этого не видят, они идут
// на английском. Английский текст — ключ, поэтому каждая строка t('…') обязана иметь русский перевод.
const root = new URL('../../ui/src/', import.meta.url);
const sources = [
  'App.vue',
  ...readdirSync(new URL('components/', root))
    .filter((name) => name.endsWith('.vue'))
    .map((name) => `components/${name}`),
];

/** Строковый литерал в исходнике — в одинарных или двойных кавычках; внутри — экранированная кавычка. */
const LITERAL = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"`;

const table =
  /const ru: Record<string, string> = \{([\s\S]*?)\n\};/u.exec(readFileSync(new URL('i18n.ts', root), 'utf8'))?.[1] ??
  '';
const keys = new Set<string>();
for (const match of table.matchAll(new RegExp(String.raw`^\s*(?:${LITERAL}|([A-Za-z][A-Za-z0-9_]*))\s*:`, 'gmu'))) {
  const key = match[1] ?? match[2] ?? match[3];
  if (key !== undefined) keys.add(key.replace(/\\(["'])/gu, '$1'));
}

it('каждая строка интерфейса имеет русский перевод', () => {
  const missing: string[] = [];
  for (const file of sources) {
    const text = readFileSync(new URL(file, root), 'utf8');
    for (const match of text.matchAll(new RegExp(String.raw`\bt\(\s*(?:${LITERAL})`, 'gu'))) {
      const key = (match[1] ?? match[2])?.replace(/\\(["'])/gu, '$1');
      if (key !== undefined && !keys.has(key)) missing.push(`${file}: ${key}`);
    }
  }
  // пустая или неразобранная таблица не должна проходить молча
  expect(keys.size).toBeGreaterThan(100);
  expect(missing).toEqual([]);
});
