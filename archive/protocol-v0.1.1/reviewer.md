# Reviewer

Read this after `AGENTS.md` when your assignment is to verify a card in `review/`. You are a separate session, not the executor of this card. The task: confirm that what the owner asked for was done — or return the card with a concrete finding.

1. `viboard show <id> --log` — the task text and the executor entries. Your session tag — `viboard session`.
2. Check the substance: the result against the task text. The `review/ready` entry ("what was done and how it was verified") is not to be trusted blindly — reproduce the verification: tests, a run, reading the changes. For interfaces — a live run in the browser, not reading the code.
3. The verdict is an action, straight away:
   - `viboard pass <id> "<how it was confirmed: what you ran, what you saw>"` → `done/` and an entry in the board `log/`;
   - `viboard fail <id> "<finding>"` → back to `doing/`. A finding is a ready decision: what breaks, how to reproduce, what to fix; with a reference to the place (file and line, or the scenario step).
4. Do not redo the executor's work: found something — return it. A typo in someone else's text is also a finding, not an edit.
5. A doubt about the task text itself is not a verdict — it is a question to the owner through the manager.
