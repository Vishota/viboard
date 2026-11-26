import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('../../ui/src/style.css', import.meta.url), 'utf8');

// Слово владельца (26.11): текст задания агента вылезал за окно. happy-dom не применяет стили к computed style,
// поэтому договор проверяем в самой таблице стилей.
it('окно «Агент»: текст задания переносится — у pre внутри окна pre-wrap и overflow-wrap', () => {
  expect(css).toMatch(/\.modal pre\s*\{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;/u);
});
