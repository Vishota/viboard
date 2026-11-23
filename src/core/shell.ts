// Команды оболочки для этой ОС — чтобы агент не подбирал их наугад и не звал Linux-команды в Windows.
// Источник один: `viboard shell` печатает таблицу в терминал, `viboard init` кладёт её в доску как shell.md.

interface Row {
  what: string;
  ps: string;
  posix: string;
  cmd: string;
}

type Column = keyof Row;

const ROWS: Row[] = [
  { what: 'list a directory', ps: 'Get-ChildItem -Force', posix: 'ls -A', cmd: 'dir /a' },
  {
    what: 'create a directory',
    ps: 'New-Item -ItemType Directory <path>',
    posix: 'mkdir <path>',
    cmd: 'mkdir <path>',
  },
  {
    what: 'remove an empty directory',
    ps: 'Remove-Item <path>',
    posix: 'rmdir <path>',
    cmd: 'rmdir <path>',
  },
  { what: 'move', ps: 'Move-Item <from> <to>', posix: 'mv <from> <to>', cmd: 'move <from> <to>' },
  {
    what: 'read a file (UTF-8)',
    ps: 'Get-Content -Raw -Encoding utf8 <file>',
    posix: 'cat <file>',
    cmd: 'type <file>',
  },
  {
    what: 'search file contents',
    ps: "Get-ChildItem -Recurse -Filter *.md <dir> | Select-String '<text>' | Select-Object -ExpandProperty Path",
    posix: "grep -rl -- '<text>' <dir>",
    cmd: 'findstr /s /m /c:"<text>" <dir>\\*.md',
  },
  {
    what: 'current UTC time for an entry name',
    ps: "(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHHmmssZ')",
    posix: 'date -u +%Y-%m-%dT%H%M%SZ',
    cmd: '—',
  },
];

const HEADER: Row = { what: 'task', ps: 'PowerShell (Windows)', posix: 'POSIX: bash, zsh, Git Bash', cmd: 'cmd' };
const ALL: Column[] = ['what', 'ps', 'posix', 'cmd'];

const INTRO =
  'The viboard CLI is the same everywhere. Shell commands are only needed without the CLI (no Node) or to search file contents.';

const PROBE = [
  '## Find your shell — with one command',
  '',
  '```',
  'echo $PSVersionTable',
  '```',
  '',
  '- a table — PowerShell;',
  '- an empty line — a POSIX shell (bash, zsh; Git Bash on Windows);',
  '- the literal text `$PSVersionTable` — cmd.',
  '',
  'From here on use only your own column. Linux commands do not work in PowerShell, and vice versa.',
].join('\n');

const escapeCell = (text: string): string => text.replace(/\|/gu, '\\|');

/** Markdown-таблица — для shell.md в доске. */
function markdown(keys: Column[]): string {
  const line = (row: Row): string => `| ${keys.map((k) => escapeCell(row[k])).join(' | ')} |`;
  return [line(HEADER), `| ${keys.map(() => '---').join(' | ')} |`, ...ROWS.map(line)].join('\n');
}

/** Выровненный текст — для терминала (`viboard shell`): только столбцы этой ОС. */
function aligned(keys: Column[]): string {
  const width = (k: Column): number => Math.max(HEADER[k].length, ...ROWS.map((r) => r[k].length));
  const line = (row: Row): string =>
    keys
      .map((k) => row[k].padEnd(width(k)))
      .join('  ')
      .trimEnd();
  return [line(HEADER), ...ROWS.map(line)].join('\n');
}

const thisOs = (): Column[] => (process.platform === 'win32' ? ALL : ['what', 'posix']);

/** Текст shell.md в доске: все оболочки — доску читают агенты на разных ОС. */
export function shellDoc(): string {
  return `# Shell commands for your OS\n\n${INTRO}\n\n${PROBE}\n\n## Commands\n\n${markdown(ALL)}\n\n\`mkdir\` is an atomic claim: if it fails, the card is taken. Paths with \`/\` work in all three shells.\n`;
}

/** Вывод `viboard shell` — подсказка определения оболочки (в Windows) и таблица для этой ОС. */
export function shellHelp(): string {
  const probe =
    process.platform === 'win32'
      ? 'Your shell is the one you actually run in. Find it with one command:  echo $PSVersionTable\n' +
        '  a table          → PowerShell\n' +
        '  an empty line    → POSIX shell (bash, zsh; Git Bash on Windows)\n' +
        '  literal text     → cmd\n\n'
      : '';
  return `${probe}${INTRO}\n\n${aligned(thisOs())}\n`;
}
