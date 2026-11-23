import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/cli/args.js';
import { instant } from '../../src/cli/main.js';
import { VERSION } from '../../src/core/version.js';

// Регресс: `viboard --version` и `viboard --help` запускали интерфейс доски вместо ответа (найдено при публикации).
describe('version and help', () => {
  it('--version and -v answer the version wherever they stand', () => {
    for (const argv of [['--version'], ['-v'], ['ui', '--version']]) {
      expect(instant(parseArgs(argv)), argv.join(' ')).toBe(VERSION);
    }
  });

  it('--help, help and -h answer the usage and never start anything', () => {
    for (const argv of [['--help'], ['help'], ['-h'], ['ui', '--help']]) {
      expect(instant(parseArgs(argv)), argv.join(' ')).toContain('viboard session');
    }
  });

  it('no flag — no instant answer: the command runs as usual', () => {
    expect(instant(parseArgs([]))).toBeNull();
    expect(instant(parseArgs(['ui']))).toBeNull();
    expect(instant(parseArgs(['ls', '--log']))).toBeNull();
  });
});
