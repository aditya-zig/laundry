# Current workstream

State of record is the newest checkpoint under `docs/implementation/production-application/`. GitHub issue bodies and `TASKS.json` state fields are projections; when they disagree with the checkpoints, trust the checkpoints.

Canonical worktree: `/home/batman/Projects/code/laundry-production-app`
Canonical branch: `work/facility-recovery-20261026` (pushed to `origin`)

- Before trusting this checkout's `git status` or GitHub state for planning, read this file first.
- Refresh this file as part of every checkpoint commit; a stale pointer is a process fault, not a missing file.
- Verification runs only in the canonical worktree while `git status --porcelain` is empty. Do not edit tracked sources while receipts are being recorded.
- After any work session, `pnpm agents:local-status` must be checked; unpushed commits have no backup.

Latest verified evidence (update on each checkpoint):

- 2026-11-09: clean-revision receipts at `e41049b95c801f087343b58db61005d1172a93e6` with an empty worktree: four-role browser journey (exit 0; four distinct role videos), customer-v2 restore rehearsal (exit 0; PostgreSQL 17.11, 91 tables matched, delivered order plus one private review and one support case) and the original 1080p30 recording (exit 0; 122.17 s, four sample frames inspected). Digest indexes live under `.verification/checkpoints/<that sha>/`; see `production-application/clean-revision-checkpoint-20261109.md`. The same day's earlier full clean batch at `64943d25`: build/check/contracts/tooling plus the workspace suite on a disposable Docker PostgreSQL (API 373, contracts 104, fixtures 237, SDK 165, foundation 55, customer 126, partner 55, ops 87, tokens 2).
- 2026-10-27: clean checkpoints for native session storage and staff support console with their own receipts; see `native-session-storage.md` and `staff-support-console.md`.
