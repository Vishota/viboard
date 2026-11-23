# Spending fewer tokens

Every file you read costs tokens until the end of the session. The board is built so that status is read by listing, not by reading.

- **List first, then read.** `viboard ls` — the whole board; `viboard show <id>` — one card. Do not read every `README.md` in a row; do not read `done/`.
- **The name carries the meaning.** `vishota.com-P1-003-tipografika` — project, priority, essence. A log entry name is time, tag, type. Choose by name and open only what you need: the last 2–3 entries, or only `*-decision.md` and `*-review.md`.
- **Search contents instead of reading.** With `rg` (ripgrep) — the same on every OS: `rg -l '<phrase>' <board> -g README.md`. Without it — the commands of your own shell in `shell.md`.
- **Write short.** A log entry is 1–3 lines of essence plus a pointer to the source; no retelling, no "see above". The outcome of the work goes into the `review` entry; a report with no reader is not written.
- **Do not duplicate.** One fact lives in one place: a decision — a `decision` entry, a question — a thread, a `note` — only when there is something to remember.
- **Large data — as a file in `assets/`.** Do not put dumps and long logs into `README.md` or entries; do not merge entries into one big file.
- **Your session tag** — keep it at hand (`--session <tag>`); after a context compaction it is visible in the name of your own `lock-<tag>`.
