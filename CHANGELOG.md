# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Card numbers refer to the project board.

## [0.2.0] — 2026-11-26

### Added

- **The owner's answer brings the card back** (057). When you answer in a thread, the card returns from `blocked/` to `todo/` by itself: the lock is removed and an `answer` entry is written in its log, so any free agent can take it. The card gets the mark «answered» — in the interface and in `viboard ls`.
- **Chat and card are linked** (057): the chat list shows the project of the card, «Open card» in a thread opens its card, «Chat» in the card window opens its thread.
- **Labels** (059): `labels: [agent, v0.2.0]` in the card's frontmatter, the known list in `labels.yml`. A card created through the CLI always carries `agent`. The interface filters by a label (a version in one click), `viboard ls --label v0.2.0` and `grep` find cards without opening them.
- **Remote access on the same port** (141): `viboard public <password>` makes the running interface public — everyone, including localhost, signs in; `viboard local <password>` returns to localhost without a password. No second port.
- **`viboard show <id>` prints the whole thread of the card** (140), every message in order, without `--log` — an agent reads the entire conversation.
- **Draft recovery** (154): what you type in the chat is saved as you type and survives a reload; the field opens empty and an inconspicuous link «Restore draft» brings the text back.
- **The card id is visible in the interface** (138) — on the card in the column and in the open card; a click copies it.
- **The mark «question for you»** on a card whose question is still unanswered — the accent marks where your word is needed; «answered» is neutral (057).

- **The viboard icon everywhere** (150): the exe file, the taskbar and the window carry the site favicon instead of the default Electron icon.

### Fixed

- **The Windows taskbar pin did not open the app** (046): the portable exe unpacks itself into a temporary folder, and the pin pointed to it. There is now an installer (`viboard-desktop Setup <version>.exe`) with a permanent location — pinning works with it; the portable file remains for those who want a single file. The window's identifier for the taskbar is the application id, the same as that of the installer's shortcuts.
- Option buttons in a chat thread showed raw markup («**A.** …»); now «A. …», and that text goes as the answer (057).
- One request to the mode endpoint without the control token could crash the server (141).

## [0.1.3] — 2026-11-25

### Changed

- All links lead to the public repository <https://github.com/Vishota/viboard> — in the interface, README and the package metadata (051).
- The desktop build writes `<name>.exe.sha256` next to the exe (046).

## [0.1.2] — 2026-11-25

### Added

- **Sync between devices through git** (049): when the board is a git repository of its own, changes are committed and pushed and pulled from other devices automatically while the interface is open. A conflict never blocks the board: the pull is undone and the window gives a prompt for an agent to resolve it.
- **`viboard-desktop.exe`** for Windows (046): the board in its own window, without Node. Portable, one file.
- **What is open is kept in the page address** (072): `?card=<name>`, `?thread=…&chat=1`, `?agent`, `?board`, `?help`, `?task` — a link opens the same.
- **Search and filters** (044): text, project, priority, «In progress», «Waiting for you».
- **Interface language Ru/En** and the help window with the first steps, shown once (048).
- **One default board for the device** (047): `viboard board`, `viboard board set`, `viboard board move`; the «Board» window.
- **Help for agents** in the CLI and the manager's regulation of the package protocol (045, 070): a question to the owner — only through a thread; the full manager regulation.

### Changed

- **The priority is no longer part of the card folder name** (050): `vishota.com-003-tipografika` instead of `vishota.com-P1-003-tipografika`. Changing the priority no longer renames the folder. `viboard check` points at old folders, `viboard fix` renames them.
- Columns stretch to the full height of the board, so a card can be dropped anywhere along the neighbouring column (058).

### Fixed

- A card did not open after its priority had been changed (050).
- `viboard unblock` and `viboard mv` ignored `$VIBOARD_SESSION` and wrote an agent's action as the owner's (071).
- After review: the filter bar without a board, a late search answer, frontmatter in search (044); path placeholders and `<html lang>` (048); a board move replacing the default and busy files (047).
