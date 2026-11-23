import { afterAll, describe, expect, it } from 'vitest';
import {
  OWNER,
  cardName,
  lockTag,
  nextId,
  parseCardName,
  parseEntryName,
  sessionTag,
  slugify,
  stamp,
  utcStamp,
} from '../../src/core/names.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('sessionTag', () => {
  it('сжимает id сессии ZCode до первого блока uuid', () => {
    expect(sessionTag('sess_f58fead9-b386-406b-881c-34db1fa6b192')).toBe('f58fead9');
  });

  it('берёт первые 8 значащих символов у прочих id', () => {
    expect(sessionTag('Claude Session #2026-11-23/abc')).toBe('claudese');
    expect(sessionTag('AB-CD')).toBe('abcd');
  });

  it('тег владельца агенту недоступен', () => {
    expect(() => sessionTag('owner')).toThrow(/reserved for the owner/u);
    expect(() => sessionTag('Owner')).toThrow(/reserved for the owner/u);
    expect(sessionTag('owner', { owner: true })).toBe(OWNER);
  });

  it('пустой или невырожденный тег — ошибка с подсказкой', () => {
    expect(() => sessionTag(undefined)).toThrow(/viboard session/u);
    expect(() => sessionTag('---')).toThrow(/cannot derive/u);
  });
});

describe('slugify', () => {
  it('транслитерирует и режет по границе слова', () => {
    expect(slugify('Проверить полностью типографику сайта')).toBe('proverit-polnostyu-tipografiku');
    expect(slugify('CLI: init и запуск')).toBe('cli-init-i-zapusk');
    expect(slugify('  ', 8)).toBe('task');
    expect(slugify('Ünïcödé àé Tëst')).toBe('unicode-ae-test');
  });
});

describe('id и имена карточек', () => {
  it('NNN = max + 1 с padding до 3', () => {
    expect(nextId([], 'first')).toBe('001-first');
    expect(nextId(['001-a', '009-b', '012-c'], 'next')).toBe('013-next');
    expect(nextId(['999-a'], 'next')).toBe('1000-next');
  });

  it('<проект>-P<n>-<NNN>-<слаг> разбирается однозначно', () => {
    expect(parseCardName('vishota.com-P1-003-tipografika')).toEqual({
      project: 'vishota.com',
      priority: 1,
      id: '003-tipografika',
    });
    expect(parseCardName('my-app-p1-003-tipografika')).toBeNull();
    expect(parseCardName('app-P9-003-x')).toBeNull();
    expect(parseCardName('001-task')).toBeNull();
    expect(cardName('app', 2, '001-task')).toBe('app-P2-001-task');
  });
});

describe('parseEntryName', () => {
  it('запись карточки: время, тег, тип', () => {
    expect(parseEntryName('2026-11-23T184935Z-7c1ed096-note.md')).toEqual({
      time: '2026-11-23T184935Z',
      tag: '7c1ed096',
      card: '',
      kind: 'note',
    });
  });

  it('запись доски: с id карточки перед типом', () => {
    expect(parseEntryName('2026-11-23T184935Z-71f93fa9-001-proverit-tipografiku-done.md')).toEqual({
      time: '2026-11-23T184935Z',
      tag: '71f93fa9',
      card: '001-proverit-tipografiku',
      kind: 'done',
    });
  });

  it('имя вне формата — null', () => {
    expect(parseEntryName('.gitkeep')).toBeNull();
    expect(parseEntryName('note.md')).toBeNull();
    expect(parseEntryName('2026-11-23T184935Z-owner-msg.md')).toBeNull();
  });
});

describe('lockTag', () => {
  it('lock-<тег> и устаревший .lock-<тег>', () => {
    expect(lockTag('lock-ab12cd34')).toBe('ab12cd34');
    expect(lockTag('.lock-ab12cd34')).toBe('ab12cd34');
    expect(lockTag('lock-')).toBeNull();
    expect(lockTag('assets')).toBeNull();
  });
});

describe('stamp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'viboard-stamp-'));
  const now = new Date('2026-11-23T18:49:35Z');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('время в UTC без разделителей', () => {
    expect(utcStamp(now)).toBe('2026-11-23T184935Z');
  });

  it('токен записи и треда', () => {
    expect(stamp({ dir, session: 'ab12cd34', kind: 'note', now })).toBe('2026-11-23T184935Z-ab12cd34-note');
    expect(stamp({ dir, session: 'ab12cd34', card: '001-task', kind: 'done', now })).toBe(
      '2026-11-23T184935Z-ab12cd34-001-task-done',
    );
  });

  it('коллизия — следующая свободная секунда: сортировка не ломается', () => {
    writeFileSync(join(dir, '2026-11-23T184935Z-ab12cd34-note.md'), '');
    expect(stamp({ dir, session: 'ab12cd34', kind: 'note', now })).toBe('2026-11-23T184936Z-ab12cd34-note');
  });

  it('вложение не наезжает на существующий файл с тем же префиксом', () => {
    writeFileSync(join(dir, '2026-11-23T184935Z-ab12cd34-att-a.png'), '');
    expect(stamp({ dir, session: 'ab12cd34', kind: 'att', now })).toBe('2026-11-23T184936Z-ab12cd34-att');
  });

  it('неизвестный тип и чужой id — ошибка', () => {
    expect(() => stamp({ dir, session: 'ab12cd34', kind: 'oops' as 'note', now })).toThrow(/unknown kind/u);
    expect(() => stamp({ dir, session: 'ab12cd34', card: '../x', kind: 'note', now })).toThrow(/card id/u);
  });
});
