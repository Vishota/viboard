import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readColumns, readProjects } from '../../src/core/board.js';
import { PROTOCOL_DIR, PROTOCOL_FILES, SHELL_DOC } from '../../src/core/paths.js';
import { projectFromDir } from '../../src/core/setup.js';
import { initBoard } from '../../src/core/setup.js';
import { linkProjectAgents } from '../../src/cli/setup.js';

const root = mkdtempSync(join(tmpdir(), 'viboard-init-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const init = (board: string, updateProtocol = false): ReturnType<typeof initBoard> =>
  initBoard({
    board,
    project: { name: 'Мой проект', path: root },
    protocolDir: PROTOCOL_DIR,
    version: '9.9.9',
    updateProtocol,
    noGit: true,
  });

describe('initBoard', () => {
  it('создаёт доску: колонки, службы, проекты, протокол с версией пакета', async () => {
    const board = join(root, 'board');
    const result = await init(board);
    expect(result.created).toBe(true);
    expect(readColumns(board)).toEqual(['backlog', 'todo', 'doing', 'blocked', 'review', 'done']);
    for (const name of ['backlog', 'todo', 'doing', 'blocked', 'review', 'done', 'questions', 'log']) {
      expect(existsSync(join(board, name)), name).toBe(true);
    }
    expect(readProjects(board)).toEqual([{ id: 'moy-proekt', name: 'Мой проект', path: root }]);
    expect(result.protocol).toEqual([...PROTOCOL_FILES, SHELL_DOC]);
    expect(readFileSync(join(board, 'AGENTS.md'), 'utf8').startsWith('<!-- viboard 9.9.9 -->')).toBe(true);
    const shell = readFileSync(join(board, 'shell.md'), 'utf8');
    expect(shell).toContain('echo $PSVersionTable');
    expect(shell).toContain('| search file contents |');
    expect(shell).toContain("grep -rl -- '<text>' <dir>");
    expect(existsSync(join(board, '.gitignore'))).toBe(true);
    expect(existsSync(join(board, '.git'))).toBe(false);
  });

  it('повторный init ничего не перезаписывает; --update-protocol обновляет только протокол', async () => {
    const board = join(root, 'board');
    mkdirSync(join(board, 'todo', 'app-P1-001-lichnaya'));
    writeFileSync(join(board, 'todo', 'app-P1-001-lichnaya', 'README.md'), '');
    writeFileSync(join(board, 'manager.md'), 'правка владельца');
    const again = await init(board);
    expect(again.created).toBe(false);
    expect(again.protocol).toEqual([]);
    expect(readFileSync(join(board, 'manager.md'), 'utf8')).toBe('правка владельца');
    expect(readdirSync(join(board, 'todo'))).toContain('app-P1-001-lichnaya');

    const updated = await init(board, true);
    expect(updated.protocol).toEqual([...PROTOCOL_FILES, SHELL_DOC]);
    expect(readFileSync(join(board, 'manager.md'), 'utf8')).not.toBe('правка владельца');
  });

  it('проект по умолчанию — каталог запуска', () => {
    expect(projectFromDir('E:\\proj\\vishota.com')).toEqual({
      id: 'vishota.com',
      name: 'vishota.com',
      path: 'E:\\proj\\vishota.com',
    });
    expect(projectFromDir('/home/me/Мой Сайт')).toMatchObject({ id: 'moy-sayt', name: 'Мой Сайт' });
    expect(projectFromDir('/', 'Личное')).toMatchObject({ id: 'lichnoe', name: 'Личное' });
  });

  it('указатель в инструкциях проекта ставится один раз', () => {
    const project = join(root, 'project');
    mkdirSync(project);
    writeFileSync(join(project, 'AGENTS.md'), '# Проект\n\nПравила.');
    expect(linkProjectAgents(project, 'npx viboard')).toBe(true);
    const text = readFileSync(join(project, 'AGENTS.md'), 'utf8');
    expect(text.startsWith('# Проект\n\nПравила.\n\n## Task board')).toBe(true);
    expect(text).toContain('`board/AGENTS.md`');
    expect(text).toContain('`npx viboard`');
    expect(linkProjectAgents(project, 'npx viboard')).toBe(false);
    expect(readFileSync(join(project, 'AGENTS.md'), 'utf8')).toBe(text);

    const bare = join(root, 'bare');
    mkdirSync(bare);
    expect(linkProjectAgents(bare, 'viboard')).toBe(true);
    expect(readFileSync(join(bare, 'AGENTS.md'), 'utf8').startsWith('## Task board')).toBe(true);
  });
});
