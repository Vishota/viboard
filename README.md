# viboard — a file-based task board: Trello for you, ls and cat for your agent

A task board where everything is a folder of files. You work in an interface, as in Trello or ClickUp; an AI agent (ZCode, Claude Code, Cursor, Codex…) sees the same tasks as plain files and reads only what it needs: `ls` instead of a database, `cat` instead of an API.

- **No database, no stateful service.** A folder in a column is a status, `lock-<tag>` means "taken", a thread in `questions/` is a conversation with you.
- **Labels:** `labels: [agent, v0.2.0]` in the card — the version is filtered in the interface and found with `grep`; a card created through the CLI always carries `agent`.
- **Card names read at a glance:** `vishota.com-003-tipografika` — project, number, essence; the priority is in the card (`viboard ls` sorts by it).
- **Tokens are not wasted:** the log is small files, one per event; status is read by listing; the agent protocol is about 80 lines, the rest is per role.
- **Secure by default:** the server listens on `127.0.0.1` only; another page cannot read or change the board; for access through a tunnel there is an opt-in password.

**Repository:** <https://github.com/Vishota/viboard> — the guide, use cases and issues. Questions and bug reports: <https://github.com/Vishota/viboard/issues>.

## Quick start

Requires Node.js 20.19+ or 22.12+.

```sh
npx viboard
```

No board yet — it creates one and opens the interface; otherwise it just opens it. Then, in the interface: **Agent** → **Copy** → paste the line into the chat of your agent. A board inside a project instead of a shared one: `npx viboard init --here`. `viboard` without arguments always opens the default board — the one in your user folder or the one set with `viboard board set <path>`; move a board with `viboard board move <path>` or in the interface (the **Board** window).

After a global install the command is also available as `vitask`.

Two ways to work:

- you create cards and tell the agent "take this one";
- you assign a manager agent: it runs a pass over the board (`viboard check`), resolves the findings and hands out briefings to new sessions (`viboard prompt`).

## Commands

| Command | What it does |
|---|---|
| `viboard` | no board — creates one and opens the interface; otherwise opens it |
| `viboard ui` | the board interface; `--password <password> --public` — access through a tunnel |
| `viboard ls [column]` | the whole board, one line per card |
| `viboard show <id>` | a card: path, task text, log entries |
| `viboard claim <id>` | take it: `lock-<tag>`, an entry, `doing/` |
| `viboard ask <id> "<question>"` | ask the owner: a chat thread, the card moves to `blocked/` |
| `viboard review <id> "<what is done>"` | done, ready for verification |
| `viboard pass <id>` · `viboard fail <id>` | the reviewer's verdict |
| `viboard check` | the manager's checklist computed from the files; exit code 1 — there are warnings |
| `viboard prompt [id] --role <role>` | a ready briefing for a new session |
| `viboard shell` | shell commands for the current OS |

The full list is in `viboard help`. The protocol for agents lives in the board root: `AGENTS.md`.

## How the board is laid out

```
board/
  columns.yml  projects.yml          columns from left to right; projects: id → name and work folder
  backlog/ todo/ doing/ blocked/ review/ done/
    vishota.com-003-tipografika/
      README.md                      frontmatter + task text (written by the owner)
      log/2026-11-23T184935Z-a1b2c3d4-note.md
      assets/
      lock-a1b2c3d4/                 taken by session a1b2c3d4
  questions/                         chat with the owner: a folder = a thread
  log/                               entries about closed cards
  AGENTS.md manager.md reviewer.md tokens.md shell.md security.md
```

## Access from the internet

By default the interface is reachable from this machine only. To expose the board through a tunnel (for example, [virunx](https://www.npmjs.com/package/virunx)):

The board keeps one port. While the local interface is running:

```sh
viboard public <password>       # the same port is now public: everyone signs in, you too
npx virunx -p 8777 -s <name>    # point the tunnel at it
viboard local <password>        # back to localhost only, without a password
```

Without a running interface `viboard public <password>` starts one in public mode (the same as `viboard ui --password <password> --public`). Turning public access off requires the password, so an outsider cannot do it.

Public mode is impossible without a password. One sign-in, the session lives for 12 hours in an HttpOnly cookie, sign-in attempts are limited.

## Sync between devices (git)

When the board folder is a git repository of its own, viboard keeps it in sync: every change — yours or an agent's — is committed and pushed, and changes from other devices are pulled (about every 10 seconds while the interface is open). Open **Board** to connect a remote repository, switch either direction off, or sync by hand.

Clone the repository on a second device and run `viboard board set <path>`.

A conflict (the same file changed on two devices) never blocks the board: the pull is undone, the device keeps its changes, and the header shows **Sync conflict**. Press *Copy prompt for the agent* — the agent resolves the conflict, and the next sync goes through by itself. Locks are not stored in git.

Sync is off when Git is not installed or the board lies inside another repository.

## Desktop app (Windows)

`viboard-desktop.exe` is the same board in its own window: no Node, no terminal. The board folder is the one `viboard` uses on this machine (`~/.viboard/board` unless another folder is set), so the CLI and the window show the same cards.

```sh
npm run desktop:build        # → desktop/out/viboard-desktop <version>.exe (portable, one file)
```

The build needs the Electron runtime unpacked in `desktop/cache/electron/`: download `electron-v<version>-win32-x64.zip` from the [Electron releases](https://github.com/electron/electron/releases) (the version is the `electron` devDependency) and unpack it there once. The builder does not download it by itself.

The build also writes `<name>.exe.sha256` next to the file. The exe is not signed: Windows shows a SmartScreen warning on the first start — that is why the release page gives the checksum.

## Development

```sh
npm install
npm run check     # ESLint, Prettier, tsc + vue-tsc, Vitest
npm run build     # dist/ — the Node part and the interface
```

```
src/core/     the core: names (names.ts), frontmatter, board, operations, checklist, threads
src/cli/      viboard commands
src/server/   the HTTP server, request hardening, authentication
ui/           the interface (Vue 3)
protocol/     the protocol for agents — installed into a board
test/         tests: node and interface
```

TypeScript strict, no runtime dependencies. The rules for working in this repository are in [agents.md](agents.md) (Russian), the decision log in [decisions.md](decisions.md) (Russian).

## License

GPL-3.0-only — see [LICENSE](LICENSE). Copyright © 2026 Vishota. The original source is <https://github.com/Vishota/viboard>; every copy and derivative must keep this attribution.

## Status

0.1.0 — a working version, not published to npm yet.
