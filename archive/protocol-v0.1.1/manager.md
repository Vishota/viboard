# Board manager

Read this after `AGENTS.md` when your assignment is the manager role. The manager keeps the board consistent and `todo/` prioritized. It is a role any session takes by assignment; little expensive judgment is needed here — work economically.

## The pass

1. `viboard check` — the checklist computed from the files. `error` and `warn` require action, `info` is a hint. Resolve each one:
   - `doing/` without `lock-` → `viboard mv <id> todo`: the session never confirmed its claim.
   - `lock-` older than 24h → take it over (`viboard claim <id> --force`) or ask the owner whether the session died.
   - WIP: one session holds more than 2 cards in `doing/` → move the extra ones to `todo/`: `viboard mv <id> todo --force`.
   - `blocked/` and the owner has answered → `viboard unblock <id>`: with a lock it returns to `doing/`, without one — to `todo/`.
   - `review/` without a verdict → assign a reviewer: `viboard prompt <id> --role reviewer`.
   - `done/` without an entry in the board `log/` → `viboard mv <id> doing`. Never write entries on behalf of the executor.
   - `depends_on` points to a missing card or to one in `backlog/` → ask the owner: the frontmatter is written by the owner.
   - a card name does not match its frontmatter → `viboard fix`.
   - a thread has waited for the owner for over a day → remind the owner.
2. Prioritizing `todo/`: `viboard ls todo`. The order inside is project → priority → id. The priority cannot be changed (the frontmatter belongs to the owner); if you think it should be — propose it as one batch.
3. Dispatch — as the owner's assignment says:
   - the owner tells an agent directly "take this one" — nothing to do;
   - the owner assigned you as manager: `viboard prompt <id>` gives a ready briefing for a new session. How a session is started is decided by the environment; otherwise the owner pastes the text into a new chat. Never start more sessions than there are free cards, and never give one card to two sessions (check `lock-`).
4. Questions to the owner — as one batch, self-contained, with a recommendation, in the chat of your environment.
5. The commit of the board is made only by the manager, at the end of the pass, if the board is in git: the message says what happened (column moves, verdicts) with references to the cards. Rules and board code are committed separately.

## Boundaries

- Never edit card bodies or `answer.md`.
- Never move a card with a live `lock-`, except returning extra cards by WIP and those stuck for over 24h — and then with an entry in the card `log/`.
- Never write task text. The only exception is a verbatim relay of the owner's words: `viboard card add ... --body-file <file>` with their text unchanged.
