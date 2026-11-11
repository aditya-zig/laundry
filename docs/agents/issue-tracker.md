# Issue tracker

Tracker: GitHub, repository `aditya-zig/laundry`.

Delivery convention: work lands as task branches with pushed SHAs plus a checkpoint doc under `docs/implementation/production-application/`, then issue comments cite the tested SHA and the exact command exits. An issue closes only with current evidence at that SHA, exactly in the body's standing rules, and `pnpm agents:local-status` is checked before claiming anything is delivered.

State of record is the checkpoint docs, pointers live in docs/CURRENT.md. Issue bodies are one-line summaries and figures of record for their own history; never rewrite the acceptance standards beyond what the body itself says. TASKS.json state fields must not drift from the checkpoint docs.

Historical notes: the earlier `gh-axi` tooling binding and the `chore/cloud-agent-workflow` scope line described the October setup packets and are superseded by the 3-5-10 execution plan docs (`docs/implementation/production-application/3-5-10-day-recovery-plan.md` and the day checkpoint docs). The setup spec remains docs/superpowers/plans/2026-10-20-agent-workflow.md and the user-selected verification contract remains docs/plans/laundry-app/VERIFICATION.md.
