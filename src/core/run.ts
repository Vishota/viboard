// «Уже запущено»: файл с портом и pid в ~/.viboard/run — повторный `viboard ui` просто открывает браузер.

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { configDir } from './board.js';
import { APP } from './names.js';

export interface RunInfo {
  app: string;
  port: number;
  pid: number;
  board: string;
  startedAt: string;
}

const normalize = (p: string): string => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));

export const runFile = (board: string): string => {
  const key = createHash('sha1').update(normalize(board)).digest('hex').slice(0, 16);
  return join(configDir(), 'run', `${key}.json`);
};

export function readRun(board: string): RunInfo | null {
  try {
    const info = JSON.parse(readFileSync(runFile(board), 'utf8')) as RunInfo;
    return typeof info.port === 'number' && typeof info.pid === 'number' ? info : null;
  } catch {
    return null;
  }
}

export function writeRun(board: string, info: RunInfo): void {
  const file = runFile(board);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(info));
}

export function clearRun(board: string): void {
  rmSync(runFile(board), { force: true });
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Процесс жив и отвечает как viboard. */
export async function probe(info: RunInfo): Promise<boolean> {
  if (!alive(info.pid)) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/ping`, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json()) as { app?: string };
    return body.app === APP;
  } catch {
    return false;
  }
}

export function openBrowser(url: string): void {
  const command =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  const child = spawn(command, { shell: true, detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}
