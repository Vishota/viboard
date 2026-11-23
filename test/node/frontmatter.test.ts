import { describe, expect, it } from 'vitest';
import {
  emptyDoc,
  formatDoc,
  metaInt,
  metaList,
  metaStr,
  parseDoc,
  scalar,
  unquote,
} from '../../src/core/frontmatter.js';

const SAMPLE = `---
id: 003-tipografika
project: vishota.com
title: Проверить полностью типографику сайта
priority: 1
depends_on: []
dod:
  - Размеры шрифтов
  - "Размеры: картинки"
created: 2026-11-20
# комментарий во frontmatter
note: |
  первая строка
  вторая строка
---

# Заголовок

Текст постановки.
`;

describe('parseDoc', () => {
  const doc = parseDoc(SAMPLE);

  it('скаляры, пустой список, блок-список, блок-скаляр', () => {
    expect(metaStr(doc, 'title')).toBe('Проверить полностью типографику сайта');
    expect(metaInt(doc, 'priority', 3)).toBe(1);
    expect(metaList(doc, 'depends_on')).toEqual([]);
    expect(metaList(doc, 'dod')).toEqual(['Размеры шрифтов', 'Размеры: картинки']);
    expect(metaStr(doc, 'note')).toBe('первая строка\nвторая строка');
    expect(doc.body).toBe('# Заголовок\n\nТекст постановки.');
  });

  it('файл без frontmatter — всё тело', () => {
    expect(parseDoc('просто текст')).toEqual({ fields: [], body: 'просто текст' });
  });

  it('строчные списки', () => {
    const d = parseDoc('---\ndeps: [001-a, "002, b", 003-c]\n---\n');
    expect(metaList(d, 'deps')).toEqual(['001-a', '002, b', '003-c']);
  });
});

describe('formatDoc', () => {
  it('нетронутые поля воспроизводятся дословно, изменённые — по месту', () => {
    const doc = parseDoc(SAMPLE);
    const out = formatDoc(doc, { priority: 2 });
    expect(out).toContain('title: Проверить полностью типографику сайта');
    expect(out).toContain('priority: 2');
    expect(out).toContain('# комментарий во frontmatter');
    expect(out).toContain('dod:\n  - Размеры шрифтов\n  - "Размеры: картинки"');
    expect(out).toContain('note: |\n  первая строка\n  вторая строка');
    expect(out.endsWith('# Заголовок\n\nТекст постановки.\n')).toBe(true);
  });

  it('новые ключи добавляются, undefined удаляет', () => {
    const out = formatDoc(parseDoc('---\na: 1\nb: 2\n---\nx'), { b: undefined, c: 'три' }, 'y');
    expect(out).toBe('---\na: 1\nc: три\n---\n\ny\n');
  });

  it('строки с особыми символами пишутся JSON-строками и читаются обратно', () => {
    const tricky = 'Цена: 100 # "рокировка" \\ путь C:\\tmp';
    const out = formatDoc(emptyDoc(), { title: tricky, path: 'E:\\proj\\tasks', list: [tricky, 'просто'] }, '');
    expect(out).toContain(`title: ${JSON.stringify(tricky)}`);
    expect(out).toContain('path: E:\\proj\\tasks'); // обратный слэш — не спецсимвол в YAML без кавычек
    expect(out).toContain(`list: [${JSON.stringify(tricky)}, просто]`);
    const back = parseDoc(out);
    expect(metaStr(back, 'title')).toBe(tricky);
    expect(metaStr(back, 'path')).toBe('E:\\proj\\tasks');
    expect(metaList(back, 'list')).toEqual([tricky, 'просто']);
  });

  it('чистый документ: пустой frontmatter и тело', () => {
    expect(formatDoc(emptyDoc(), {}, 'текст')).toBe('---\n---\n\nтекст\n');
  });
});

describe('scalar и unquote', () => {
  it('безопасная строка остаётся как есть', () => {
    expect(scalar('просто текст')).toBe('просто текст');
    expect(scalar('2026-11-20')).toBe('"2026-11-20"');
    expect(scalar('true')).toBe('"true"');
    expect(scalar('42')).toBe('"42"');
    expect(scalar('# комментарий')).toBe('"# комментарий"');
    expect(scalar('a: b')).toBe('"a: b"');
  });

  it('кавычки и комментарии', () => {
    expect(unquote('"a\\nb"')).toBe('a\nb');
    expect(unquote("'it''s'")).toBe("it's");
    expect(unquote('значение  # комментарий')).toBe('значение');
  });
});
