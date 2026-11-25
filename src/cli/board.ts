// `viboard board` — где доска, какая папка default, перенос в другую папку (карточка 047).
import { boardInfo, describeBoard, moveBoard, setDefaultBoard } from '../core/home.js';
import { toPosix } from '../core/paths.js';
import { Fail } from '../core/errors.js';
import { flag, option, type Args } from './args.js';
import { need } from './context.js';
import { say } from './io.js';

const USAGE = 'viboard board · viboard board set <path> · viboard board move <path> [--force]';

export function cmdBoard(args: Args): number {
  const sub = args.positional[1] ?? 'show';
  const info = boardInfo(option(args, 'board'));
  if (sub === 'show') {
    say(`board    ${describeBoard(info)}`);
    say(`default  ${toPosix(info.defaultPath)}`);
    return info.exists ? 0 : 1;
  }
  if (sub === 'set') {
    const next = setDefaultBoard(need(args.positional[2], 'the path of an existing board'));
    say(`default  ${toPosix(next.path)}`);
    return 0;
  }
  if (sub === 'move') {
    const result = moveBoard(info.path, need(args.positional[2], 'the new folder'), { force: flag(args, 'force') });
    say(`${result.from} → ${result.to}`);
    say(`  files: ${result.files}, verified`);
    for (const lock of result.forcedLocks) say(`  moved despite ${lock} — that agent still reads the old folder`);
    for (const file of result.leftBehind) say(`  left behind (file is open in another program): ${file}`);
    if (result.leftBehind.length > 0) say(`  close that program and delete the old folder yourself: ${result.from}`);
    say(result.defaultChanged ? `  default is now the new folder` : `  default unchanged: ${result.defaultPath}`);
    return 0;
  }
  throw new Fail(`unknown «board ${sub}»\n\n${USAGE}`);
}
