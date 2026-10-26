# astroprojects — Developer Guide

Standalone Astro Ford projects, one folder each, deliberately separate from the
TextDrive / Riley sales assistant (repo `sales1`). Nothing here imports from,
shares a database with, or texts from the TextDrive number. Read the project's own
CLAUDE.md (e.g. `hiring/CLAUDE.md`) before working in it.

> **STANDING RULE — keep these docs current automatically.** At the end of any
> session that changed architecture, data model, prompts, compliance gates, env
> vars, or known state, update the relevant CLAUDE.md and commit it in the same
> push as the code, without being asked.

> **STANDING RULE — no real personal data in this repo.** Real applicant or
> customer names, phone numbers, and emails live ONLY in the running app's
> database. Never put them in code, comments, docs, test fixtures, or commit
> messages. Refer to real threads by an anonymized descriptor and use obviously
> fake names and 555-01xx numbers in examples and tests.

## Projects

- `hiring/` — Hiring Line. See `hiring/CLAUDE.md`.
