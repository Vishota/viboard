// Включаемая авторизация (публичный доступ через туннель): пароль → HttpOnly-cookie сессии на 12 ч.
// Токен сессии не попадает в URL — только cookie; запись дополнительно защищена проверкой Origin.

import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { HttpError, readCookie, secretEquals } from './http.js';

export const SESSION_COOKIE = 'viboard_session';
export const SESSION_TTL_MS = 12 * 3600e3;

export class Auth {
  private sessions = new Map<string, number>();

  constructor(
    private readonly password: string,
    /** Secure у cookie — когда страница открывается по https (туннель). */
    private readonly secureCookie: boolean,
  ) {}

  /** Пароль верен — выдать токен сессии; иначе 401. */
  login(password: string): string {
    if (!secretEquals(password, this.password)) throw new HttpError(401, 'wrong password');
    const token = randomBytes(32).toString('hex');
    this.sessions.set(token, Date.now() + SESSION_TTL_MS);
    return token;
  }

  valid(req: IncomingMessage): boolean {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) return false;
    const until = this.sessions.get(token);
    if (until === undefined) return false;
    if (until <= Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  logout(req: IncomingMessage): void {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) this.sessions.delete(token);
  }

  cookie(token: string): string {
    const parts = [
      `${SESSION_COOKIE}=${token}`,
      'HttpOnly',
      'SameSite=Strict',
      'Path=/',
      `Max-Age=${SESSION_TTL_MS / 1000}`,
    ];
    if (this.secureCookie) parts.push('Secure');
    return parts.join('; ');
  }

  /** Удалить cookie в браузере. */
  clearCookie(): string {
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${this.secureCookie ? '; Secure' : ''}`;
  }
}
