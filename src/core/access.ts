// Удалённый доступ (UD-55): устройства и одноразовый ключ подключения.
// Подключённое устройство — своя сессия с cookie на 30 дней, её можно отозвать. Ключ для подключения
// одноразовый и живёт две минуты: утёкший QR или снимок экрана бесполезны после первого использования.

import { createHash, randomBytes, randomInt } from 'node:crypto';
import { readText, writeAtomic } from './fs.js';
import type { Device } from './types.js';

export type { Device };

export const DEVICE_COOKIE = 'viboard_device';
export const DEVICE_TTL_MS = 30 * 24 * 3600e3;
export const KEY_TTL_MS = 2 * 60e3;
/** Без похожих символов (0/o, 1/l/i): ключ вводят руками с экрана другого устройства. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export const randomCode = (length: number): string => {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)] ?? 'x';
  return out;
};

interface StoredDevice extends Device {
  /** Токена в файле нет — только его хэш. */
  hash: string;
}

const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Подключённые устройства. Файл — вне доски: доска может лежать в общем git-репозитории. */
export class Devices {
  private items: StoredDevice[];

  constructor(
    private readonly file: string,
    now = new Date(),
  ) {
    const raw = readText(file);
    let parsed: Partial<StoredDevice>[] = [];
    try {
      parsed = raw === null ? [] : (JSON.parse(raw) as Partial<StoredDevice>[]);
    } catch {
      /* битый файл — считаем, что устройств нет */
    }
    const cutoff = now.getTime() - DEVICE_TTL_MS;
    this.items = parsed
      .filter((d): d is StoredDevice => typeof d.hash === 'string' && typeof d.id === 'string')
      .filter((d) => Date.parse(d.lastSeenAt ?? '') >= cutoff);
  }

  list(): Device[] {
    return this.items.map(({ id, name, createdAt, lastSeenAt }) => ({ id, name, createdAt, lastSeenAt }));
  }

  issue(name: string, now = new Date()): { token: string; device: Device } {
    const token = randomBytes(32).toString('hex');
    const device: StoredDevice = {
      id: hashOf(token).slice(0, 12),
      name: name.slice(0, 60),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      hash: hashOf(token),
    };
    this.items.push(device);
    this.save();
    return { token, device: this.list().at(-1) ?? device };
  }

  /** Устройство по токену из cookie; продлевает «видели последний раз» не чаще раза в минуту. */
  resolve(token: string, now = new Date()): Device | null {
    const hash = hashOf(token);
    const found = this.items.find((d) => d.hash === hash);
    if (found === undefined) return null;
    if (now.getTime() - Date.parse(found.lastSeenAt) > 60e3) {
      found.lastSeenAt = now.toISOString();
      this.save();
    }
    const { id, name, createdAt, lastSeenAt } = found;
    return { id, name, createdAt, lastSeenAt };
  }

  revoke(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((d) => d.id !== id);
    if (this.items.length === before) return false;
    this.save();
    return true;
  }

  private save(): void {
    writeAtomic(this.file, `${JSON.stringify(this.items, null, 2)}\n`);
  }
}

/** Одноразовый ключ подключения: выдаётся на KEY_TTL_MS и гасится первым успехом. */
export class PairingKey {
  private current: { key: string; expiresAt: number } | null = null;

  issue(now = Date.now()): { key: string; expiresAt: number } {
    this.current = { key: randomCode(6), expiresAt: now + KEY_TTL_MS };
    return this.current;
  }

  get(now = Date.now()): { key: string; expiresAt: number } | null {
    if (this.current === null || this.current.expiresAt <= now) return null;
    return this.current;
  }

  /** true — ключ верен и ещё не использован; при этом гаснет. */
  take(value: string, now = Date.now()): boolean {
    const current = this.get(now);
    if (current === null || current.key !== value.trim().toLowerCase()) return false;
    this.current = null;
    return true;
  }

  clear(): void {
    this.current = null;
  }
}

/** Короткое имя человека по браузеру: «iPhone · Safari», «Windows · Chrome», «Unknown browser». */
export function deviceName(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const os = /iPhone|iPad|iPod/iu.test(ua)
    ? 'iPhone/iPad'
    : /Android/iu.test(ua)
      ? 'Android'
      : /Windows/iu.test(ua)
        ? 'Windows'
        : /Mac OS X/iu.test(ua)
          ? 'Mac'
          : /Linux/iu.test(ua)
            ? 'Linux'
            : '';
  const browser = /Edg\//iu.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/iu.test(ua)
      ? 'Opera'
      : /Firefox\//iu.test(ua)
        ? 'Firefox'
        : /Chrome\//iu.test(ua)
          ? 'Chrome'
          : /Safari\//iu.test(ua)
            ? 'Safari'
            : '';
  return [os, browser].filter((part) => part !== '').join(' · ') || 'Unknown browser';
}
