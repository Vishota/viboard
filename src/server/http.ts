// Жёсткая прослойка HTTP: заголовки безопасности, проверка Host и Origin, лимиты тела, cookies, rate limit.
// Сервер слушает только loopback; всё, что пришло не с этой страницы или не на этот хост, — 403.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { Fail } from '../core/errors.js';

/** Ошибка с HTTP-статусом и читаемым сообщением — попадает в ответ как есть. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function securityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
}

/** Страница приложения: только свои ресурсы, без встроенных скриптов и встраивания в чужие фреймы. */
export const CSP_APP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Вложения и статика: документ открывается в песочнице — скрипты внутри файлов не выполняются. */
export const CSP_SANDBOX = "sandbox; default-src 'none'";

/**
 * Host, с которым доска принимает запрос. За паролем — любой (туннель может переписывать имя).
 * Без пароля — ровно `127.0.0.1:<порт>`: «localhost» и «[::1]» не принимаются, потому что туннель,
 * переписывающий имя (virunx так делает по умолчанию), подставляет именно их — иначе доска без пароля
 * оказалась бы открыта наружу (UD-55). Своё окно всегда открывается по 127.0.0.1.
 */
export function hostAllowed(host: string | undefined, port: number, protectedByPassword: boolean): boolean {
  if (protectedByPassword) return true;
  return host !== undefined && host.toLowerCase() === `127.0.0.1:${port}`;
}

export interface OriginPolicy {
  devOrigins: readonly string[];
  publicAccess: boolean;
}

type Headers = IncomingMessage['headers'];

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * CSRF: небезопасные методы принимаются только с этой страницы. Браузер всегда шлёт Origin на POST;
 * нет Origin — это не наша страница. Host сравнивается с Host / X-Forwarded-Host (туннель без rewrite).
 */
export function originAllowed(headers: Headers, policy: OriginPolicy): boolean {
  const origin = first(headers.origin);
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const own = [first(headers.host), first(headers['x-forwarded-host'])]
    .filter((h): h is string => h !== undefined)
    .map((h) => h.toLowerCase());
  return own.includes(host) || policy.devOrigins.some((o) => o.toLowerCase() === origin.toLowerCase());
}

/** Тело запроса байтами (не строками: многобайные символы не рвутся на границе чанка), с лимитом. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        req.pause();
        reject(new HttpError(413, 'request body is too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    });
  });
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Сравнение секретов за постоянное время. */
export const secretEquals = (a: string, b: string): boolean => {
  const digest = (s: string): Buffer => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
};

interface Bucket {
  hits: number;
  reset: number;
}

/** Счётчики по ключу (IP) в памяти; окно скользящее по интервалам. */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  /** true — пропуск; false — лимит окна исчерпан. */
  take(key: string, limit: number, windowMs: number, now: number = Date.now()): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.reset <= now) {
      bucket = { hits: 0, reset: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.hits += 1;
    if (this.buckets.size > 5000) this.sweep(now);
    return bucket.hits <= limit;
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.reset <= now) this.buckets.delete(key);
    }
  }
}

/** Ответ ошибкой: статус HttpError, 400 для Fail (ошибка человека), 500 — прочее (в лог). */
export function respondError(res: ServerResponse, e: unknown): void {
  const status = e instanceof HttpError ? e.status : e instanceof Fail ? 400 : 500;
  if (status === 500) console.error(e);
  if (res.headersSent) {
    res.end();
    return;
  }
  if (status === 413) res.setHeader('Connection', 'close');
  const message = status === 500 ? 'internal server error' : e instanceof Error ? e.message : 'error';
  sendJson(res, status, { error: message });
}

/** Слушать один порт: занят — отказ (see listenWithFallback). */
export function listenOnce(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error): void => {
      server.off('listening', onListening);
      reject(e);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/** Порт занят (или зарезервирован системой) — следующий свободный, чтобы запуск не падал. */
export async function listenWithFallback(server: Server, port: number, host: string): Promise<number> {
  let last: unknown;
  for (let candidate = port; candidate < Math.max(port, 1) + 20; candidate++) {
    try {
      await listenOnce(server, candidate, host);
      const address = server.address();
      return address !== null && typeof address === 'object' ? address.port : candidate;
    } catch (e) {
      last = e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw e;
    }
  }
  throw new Error(`no free port from ${port} upward: ${(last as Error).message}`);
}
