// Туннель для удалённого доступа (UD-55): virunx — клиент того же владельца, выносит локальный порт за
// публичную ссылку. Версия фиксирована точно: пара «viboard + virunx» проверяется вживую, а не наугад.
// В exe клиент вшит при сборке (пустой системе не нужен ни Node, ни npm); в npm-пакете зависимости
// в рантайме нет (UD-25) — клиент ставится по согласию владельца, через npm, вызванный рядом с node.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { delimiter, join } from 'node:path';
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

/** Где искать клиента: <корень>/node_modules/virunx — в пакете (вшит в exe) и в папке настроек (поставлен по согласию). */
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
      // версия — точно заданная: пара «viboard + virunx» проверена вживую; другая считается отсутствующей
      if (pkg.version === TUNNEL_TOOL.version && typeof bin === 'string' && existsSync(join(dir, bin))) {
        return { state: 'ready', source: sources[i] ?? 'installed', cli: join(dir, bin) };
      }
    } catch {
      /* битый package.json — идём дальше */
    }
  }
  return { state: 'missing', source: null, cli: null };
}

/**
 * npm без PATH и оболочки — рядом с исполнимым файлом node: так работает и при сломанном PATH.
 * Windows и каталоги версий (nvm, fnm, volta) держат npm под bin; unix — в lib/node_modules;
 * Debian/Ubuntu — в share/nodejs. Последний довод — npm из PATH, по ссылке на его каталог.
 */
export function npmCandidates(): string[] {
  const nodeDir = join(process.execPath, '..');
  const cli = (...parts: string[]): string => join(nodeDir, ...parts, NPM_CLI);
  const candidates = [
    cli('node_modules'),
    cli('..', 'lib', 'node_modules'),
    cli('..', '..', 'lib', 'node_modules'),
    cli('..', 'share', 'nodejs'),
    cli('..', '..', 'share', 'nodejs'),
    ...npmOnPath(),
  ];
  return [...new Set(candidates)].filter((file) => existsSync(file));
}

const NPM_CLI = join('node_modules', 'npm', 'bin', 'npm-cli.js');

function npmOnPath(): string[] {
  const name = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const found: string[] = [];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    found.push(join(dir, NPM_CLI));
    // unix: bin/npm — ссылка на npm-cli.js (установщик, Homebrew) либо на сценарий в lib/node_modules
    let real: string;
    try {
      real = realpathSync(join(dir, name));
    } catch {
      continue;
    }
    if (real.endsWith(NPM_CLI)) found.push(real);
    found.push(join(real, '..', '..', 'lib', NPM_CLI));
  }
  return found;
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
    throw new Error(
      `npm is not found next to node — run it yourself: npm install --prefix "${installDir}" ${TUNNEL_TOOL.package}@${TUNNEL_TOOL.version}`,
    );
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
