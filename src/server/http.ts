// Жёсткая прослойка HTTP: заголовки безопасности, проверка Host и Origin, лимиты тела, cookies, rate limit.
// Сервер слушает только loopback; всё, что пришло не с этой страницы или не на этот хост, — 403.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

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

const loopbackHosts = (port: number): string[] => [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];

/** Защита от DNS rebinding: в локальном режиме Host — только loopback с нашим портом. */
export function hostAllowed(host: string | undefined, port: number, publicAccess: boolean): boolean {
  if (publicAccess) return true; // за туннелем Host переписывается; доступ защищает пароль
  return host !== undefined && loopbackHosts(port).includes(host.toLowerCase());
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
