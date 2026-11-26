// Туннель для удалённого доступа (UD-55): virunx — клиент того же владельца, выносит локальный порт за
// публичную ссылку. Версия фиксирована точно: пара «viboard + virunx» проверяется вживую, а не наугад.
// В exe клиент вшит при сборке (пустой системе не нужен ни Node, ни npm); в npm-пакете зависимости
// в рантайме нет (UD-25) — клиент ставится по согласию владельца, через npm, вызванный рядом с node.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readText } from './fs.js';
import { randomCode } from './access.js';
import type { TunnelTool } from './types.js';

export const TUNNEL_TOOL = { package: 'virunx', version: '0.5.0' } as const;
/** Туннель называем случайно: имя уходит в ссылку и в код для ручного ввода. */
const TUNNEL_PREFIX = 'viboard';

/** Клиент туннеля найден — и где его исполняемый файл. */
export interface FoundTool extends TunnelTool {
  cli: string | null;
}

/** Где искать клиента: <корень>/tools/node_modules/virunx — в пакете (exe) и в папке настроек (npm). */
export function findTunnelTool(roots: readonly string[]): FoundTool {
  const sources: TunnelTool['source'][] = ['bundled', 'installed'];
  for (const [i, root] of roots.entries()) {
    const dir = join(root, 'node_modules', TUNNEL_TOOL.package);
    const json = readText(join(dir, 'package.json'));
    if (json === null) continue;
    try {
      const pkg = JSON.parse(json) as { version?: unknown; bin?: unknown };
      const bin =
        typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin as Record<string, string> | undefined)?.[TUNNEL_TOOL.package];
      if (typeof bin === 'string' && existsSync(join(dir, bin))) {
        return { state: 'ready', source: sources[i] ?? 'installed', cli: join(dir, bin) };
      }
    } catch {
      /* битый package.json — идём дальше */
    }
  }
  return { state: 'missing', source: null, cli: null };
}

/** npm рядом с исполнимым файлом node — без PATH и оболочки: так работает и при сломанном PATH. */
export function npmCandidates(): string[] {
  const nodeDir = join(process.execPath, '..');
  return [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter((file) => existsSync(file));
}

function run(args: string[], onText?: (text: string) => void): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      // ELECTRON_RUN_AS_NODE: в exe process.execPath — сам Electron; так он ведёт себя как node
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    const collect = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      onText?.(output);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, output }));
  });
}

/** Поставить клиента точно заданной версии в <installDir>/node_modules — без сценариев пакета. */
export async function installTunnelTool(installDir: string): Promise<void> {
  const npm = npmCandidates()[0];
  if (npm === undefined)
    throw new Error('npm is not found next to node — install virunx yourself: npm install -g virunx');
  const { code, output } = await run([
    npm,
    'install',
    '--prefix',
    installDir,
    '--no-audit',
    '--no-fund',
    '--ignore-scripts',
    '--loglevel=error',
    '--no-warnings',
    `${TUNNEL_TOOL.package}@${TUNNEL_TOOL.version}`,
  ]);
  if (code !== 0) throw new Error(`npm install failed (${code ?? 'no exit code'}): ${lastLine(output)}`);
}

const lastLine = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1) ?? '';

export interface Tunnel {
  /** Ссылка, которую relay выдал туннелю. */
  url: string;
  stop(): Promise<void>;
}

/**
 * Поднять туннель до локального порта. Скрытый (не в списке relay) и без подмены имени: viboard видит
 * настоящий публичный Host. Имя занято — пробует другое (до трёх раз). Клиент упал после запуска —
 * onExit с последней строкой его вывода (остановка через stop не считается падением).
 */
export function startTunnel(options: {
  cli: string;
  port: number;
  onLog?: (line: string) => void;
  onExit?: (reason: string) => void;
}): Promise<Tunnel> {
  const attempt = (triesLeft: number): Promise<Tunnel> =>
    new Promise<Tunnel>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          options.cli,
          '-p',
          String(options.port),
          '-s',
          `${TUNNEL_PREFIX}-${randomCode(4)}`,
          '--hidden',
          '--no-rewrite-host',
          '--yes',
        ],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
      let output = '';
      let settled = false;
      let stopping = false;
      const read = (chunk: Buffer): void => {
        const text = chunk.toString('utf8');
        output += text;
        for (const line of text.split('\n')) if (line.trim() !== '') options.onLog?.(line.trimEnd());
        const url = /live\s+(https:\/\/\S+)/u.exec(output)?.[1];
        if (url !== undefined && !settled) {
          settled = true;
          resolve({
            url,
            stop: async () => {
              stopping = true;
              await stop(child);
            },
          });
        }
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.on('error', (error) => {
        if (!settled) reject(error);
        else options.onExit?.(error.message);
      });
      child.on('exit', (code) => {
        if (settled) {
          if (!stopping) options.onExit?.(lastLine(output) || `virunx exited with code ${code ?? '?'}`);
          return;
        }
        settled = true;
        const taken = /id-taken/u.test(output);
        if (taken && triesLeft > 1) return resolve(attempt(triesLeft - 1));
        reject(new Error(lastLine(output) || `virunx exited with code ${code ?? '?'}`));
      });
    });
  return attempt(3);
}

async function stop(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill();
  });
}
