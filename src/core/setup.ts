// `viboard init`: создаёт доску (или дополняет существующую) — колонки, projects.yml, протокол, git.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_COLUMNS, isBoard, readProjects, writeColumns } from './board.js';
import { Fail } from './errors.js';
import { ensureDir, readText, writeAtomic } from './fs.js';
import { projectId, SYNC_SETTINGS } from './names.js';
import { addProject } from './ops.js';
import { PROTOCOL_FILES, SHELL_DOC, toPosix } from './paths.js';
import { shellDoc } from './shell.js';

const execFileAsync = promisify(execFile);

export interface InitOptions {
  board: string;
  /** Первый проект доски: имя и каталог, где агент работает по его карточкам. */
  project: { id?: string; name: string; path: string };
  protocolDir: string;
  version: string;
  /** Перезаписать файлы протокола в доске текущей версией. */
  updateProtocol?: boolean;
  /** Не создавать git-репозиторий внутри доски. */
  noGit?: boolean;
}

export interface InitResult {
  board: string;
  created: boolean;
  /** Файлы протокола, записанные в этом запуске. */
  protocol: string[];
  git: boolean;
}

const touch = (file: string, content = ''): void => {
  if (!existsSync(file)) writeAtomic(file, content);
};

/** Доска уже внутри git-репозитория (например, проекта) — свой репозиторий не нужен. */
async function insideWorkTree(dir: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export async function initBoard(options: InitOptions): Promise<InitResult> {
  const { board } = options;
  const created = !isBoard(board);
  ensureDir(board);
  for (const column of DEFAULT_COLUMNS) touch(join(board, column, '.gitkeep'));
  for (const service of ['questions', 'log']) touch(join(board, service, '.gitkeep'));
  if (!existsSync(join(board, 'columns.yml'))) writeColumns(board, [...DEFAULT_COLUMNS]);
  if (readProjects(board).length === 0) addProject(board, options.project);
  touch(join(board, '.gitignore'), `lock-*/\n.lock-*/\n${SYNC_SETTINGS}\n`);

  const protocol: string[] = [];
  for (const file of PROTOCOL_FILES) {
    const dst = join(board, file);
    if (existsSync(dst) && !options.updateProtocol) continue;
    const src = join(options.protocolDir, file);
    const text = readText(src);
    if (text === null)
      throw new Fail(`protocol file ${toPosix(src)} is missing — the package was built without protocol/`);
    writeAtomic(dst, text.replace('{{version}}', options.version));
    protocol.push(file);
  }
  // shell.md собирается из кода: одна таблица команд — для терминала и для доски
  if (!existsSync(join(board, SHELL_DOC)) || options.updateProtocol) {
    writeAtomic(join(board, SHELL_DOC), shellDoc());
    protocol.push(SHELL_DOC);
  }

  let git = false;
  if (created && !options.noGit && !(await insideWorkTree(board))) {
    try {
      await execFileAsync('git', ['init', '-q'], { cwd: board, windowsHide: true });
      git = true;
    } catch {
      git = false; // без git доска работает — просто без истории
    }
  }
  return { board, created, protocol, git };
}

/** Проект по умолчанию — каталог, из которого запустили init. */
export const projectFromDir = (dir: string, name?: string): { id?: string; name: string; path: string } => {
  const base = dir.split(/[\\/]/u).filter(Boolean).at(-1) ?? 'project';
  const title = name?.trim() || base;
  return { id: projectId(title), name: title, path: dir };
};
