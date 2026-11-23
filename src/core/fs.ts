// Файловые примитивы доски: читать маленькое, писать атомарно, двигать каталоги.
// Символические ссылки не разыменовываются: доска — только то, что лежит в ней настоящими файлами.

import {
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/** Текст обычного файла (не ссылки) в UTF-8 либо null. */
export function readText(file: string): string | null {
  return readFileSyncSafe(file)?.toString('utf8') ?? null;
}

/** Байты обычного файла (не ссылки) либо null. */
export function readFileSyncSafe(file: string): Buffer | null {
  try {
    return lstatSync(file).isFile() ? readFileSync(file) : null;
  } catch {
    return null;
  }
}

export function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Обычный файл (не ссылка) на месте? */
export const isRealFile = (path: string): boolean => {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
};

export const isRealDir = (path: string): boolean => {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
};

export const mtimeMs = (path: string): number | null => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
};

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** Запись через временный файл: читатель никогда не видит половину файла. */
export function writeAtomic(file: string, data: string | Buffer): void {
  ensureDir(dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/** Перемещение каталога/файла; между дисками — копирование (EXDEV). */
export function movePath(src: string, dst: string): void {
  ensureDir(dirname(dst));
  try {
    renameSync(src, dst);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    cpSync(src, dst, { recursive: true });
    rmSync(src, { recursive: true, force: true });
  }
}
