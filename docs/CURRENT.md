# Current workstream

State of record is the newest checkpoint under `docs/implementation/production-application/`. GitHub issue bodies and `TASKS.json` state fields are projections; when they disagree with the checkpoints, trust the checkpoints.

Canonical worktree: `/home/batman/Projects/code/laundry-production-app`
Canonical branch: `work/facility-recovery-20261026` (pushed to `origin`)

- Before trusting this checkout's `git status` or GitHub state for planning, read this file first.
- Refresh this file as part of every checkpoint commit; a stale pointer is a process fault, not a missing file.
- Verification runs only in the canonical worktree while `git status --porcelain` is empty. Do not edit tracked sources while receipts are being recorded.
- After any work session, `pnpm agents:local-status` must be checked; unpushed commits have no backup.

Latest verified evidence (update on each checkpoint):

- 2026-11-09: full clean batch at `64943d25ba1d619d3b3ae726da4a707a38c1943b` exited 0 (install frozen, build, check, check:convex, contracts:check, test:tooling, then the workspace suite on a disposable Docker PostgreSQL): API 373, contracts 104, fixtures 237, SDK 165, foundation 55, customer 126, partner 55, ops 87, design tokens 2. Four-role browser journey, customer-v2 restore archive and HQ recording receipts are in flight at this branch tip.
- 2026-10-27: clean checkpoints for native session storage and staff support console with their own receipts; see `native-session-storage.md` and `staff-support-console.md`.
