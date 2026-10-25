# D01 handoff — taste-led design system and reference screens

Task: D01 · Issue: Create the taste-led design system and reference screens for all three apps.
Worker: isolated cloud task D01 (design).
Status: RUNNING.

## Identity

- Source SHA (candidate checked out): a34281a2bad86b67f5de0ae0742652fd6a4d3f82
- Inherited baseline: 16eddf74e29945932a8042d2aae88c944ea6c9f1
- Candidate OpenAPI SHA256: 1e14e90db26d9715e187b70e361a4283713f4a37396367635c09c36945227626
- Contract target: `laundry-wire-v2.0.0` (freeze by C01; D01 consumes shapes, does not edit contracts)
- Design direction (fixed): Framed sheet, seed `1278588346`, navy/teal identity — white surface `#FFFFFF`, pale-blue frame `#EEF4FF`, ink `#0F1F3D`, action `#0E7C7B`; existing semantic error/warning/success tokens. No resampling without a documented constraint.

## Scope and ownership (exclusive)

- `packages/design-tokens/**`
- `packages/ui/**`
- `docs/design/production/**`
- `docs/implementation/handoffs/D01/**`

Output routing contract (from dispatch):
- Taste draw output → `docs/design/production/direction` (`--out`), never `.taste-skill` outside ownership.
- Inspector output → `.verification/cloud-batch/D01/visual` (`--out`).
- Do not edit app routes, root manifests/lockfile, packages/contracts, SDK, migrations, composition. Coordinator owns those.

## State at dispatch (verified)

- `packages/design-tokens/` exists with `src/`, `test/`, package.json, tsconfigs, vitest config (inherited; content review pending).
- `packages/ui/` — does not exist yet; to be created within ownership (no root manifest/dependency changes).
- `docs/design/production/` — does not exist yet.
- `docs/implementation/handoffs/D01/` — this initial handoff only.
- Prior draw note: the prior run reproduced Framed sheet seed `1278588346` but built no UI. This run must produce the design foundation and reference screens, not another audit.

## Plan (bounded slice)

1. Inspect existing `packages/design-tokens` source and tests; check for an existing Framed-sheet direction artifact from the prior draw.
2. Read remaining skill references fully; re-run/reprint the committed taste draw with `--out docs/design/production/direction` (`--app`, `--keep palette,type`, seed `1278588346`) to reproduce the committed direction sheet as a file.
3. Build semantic token/state/copy/custody-receipt specs in `packages/design-tokens` (extend existing stack, no new root dependencies).
4. Build reusable web controls + custody receipt in `packages/ui` where existing manifests support them.
5. Reference HTML screens in `docs/design/production`: customer booking/tracking, rider task/handover, operations queue/intake — self-contained, honest states (loading/empty/error/offline/permission/payment), no fabricated business approvals or ratings.
6. Gate: `node .agents/skills/design-taste-frontend/scripts/lint.mjs --app`, `inspect.mjs --app --out .verification/cloud-batch/D01/visual`. Real browser inspector if Chrome/Chromium is available; otherwise record `BLOCKED_ENV` for visual inspection and never claim screenshots were inspected.
7. Update this handoff incrementally with commands, argv, exit codes, scenarios and tested SHA.

## Commands run (log)

(to be appended as work proceeds)

## Blockers

(to be maintained)
