// Разбор аргументов командной строки: `--ключ значение`, `--ключ=значение`, `--флаг`, позиционные.
// Без зависимостей. Всё после `--` — позиционные (текст с дефисами).

export interface Args {
  positional: string[];
  flags: Record<string, string | true>;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--') {
      args.positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        args.flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args.flags[a.slice(2)] = next;
        i++;
      } else args.flags[a.slice(2)] = true;
    } else args.positional.push(a);
  }
  return args;
}

/** Значение опции (`--ключ значение`) либо undefined. */
export function option(args: Args, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/** Флаг задан и не равен явному «false». */
export function flag(args: Args, name: string): boolean {
  const v = args.flags[name];
  return v !== undefined && v !== 'false';
}
