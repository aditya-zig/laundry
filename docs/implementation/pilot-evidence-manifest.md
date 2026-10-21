# Pilot evidence manifest and runbook

Run `20261020191753`, branch `feat/backend-mvp`, base
`fc8e58f53707cf8fcea3763137e0f469311f1aa3`. This is the current-revision
evidence for the kg pilot. The binaries are local and ignored; this file is the
tracked, reproducible record.

No handover codes or session tokens are written here.

## Environment

| Item | Value |
| --- | --- |
| Worktree | `/home/batman/Projects/code/.worktrees/laundry-backend-mvp` |
| API | `http://127.0.0.1:4100/v1` (`HOST` unset, loopback default) |
| Console | `http://localhost:5175/` (Vite proxy `/v1` to the API) |
| Browser demo DB | `laundry_verify_mvp` on local `127.0.0.1:5549` |
| Isolated test DB | `laundry_verify_builder_20261021` on the same container |
| Browser | Playwright Chromium, 1440x1000, video recorded |
| Run id | `20261020191753` |

The reviewer database `laundry_verify_reviewer_20261021` and reviewer order
`088fa2e3-4b7d-4839-8fc7-5474810aa07a` are outside this run.

## Reproduce

```bash
cd /home/batman/Projects/code/.worktrees/laundry-backend-mvp
pnpm install --frozen-lockfile

# Start the API against the browser DB, then the console.
DATABASE_URL="postgres://wandary:verification_only@localhost:5549/laundry_verify_mvp" \
DEMO_MODE=true PILOT_ENABLED=true PORT=4100 \
pnpm --filter @wandary/api dev

PILOT_API_URL=http://localhost:4100 \
pnpm --filter @wandary/pilot-console exec vite --port 5175 --strictPort

# Current-revision evidence.
node tools/verification/pilot-console.mjs

# Restart persistence. The ids are printed by the run and stored in summary.json.
node tools/verification/check-persistence.mjs <paidOrderId> <heldOrderId>

# Local-only taste meter; requires the ignored .agents/ skill install.
node .agents/skills/design-taste-frontend/scripts/inspect.mjs \
  --app "http://localhost:5175/?as=customer" --out .taste-skill/final-customer
```

The browser script's assertions cover:

- one order after a double click, with the SDK list matching the exact address;
- the address value retained after a 3.4 second poll;
- the map popup showing literal `<b>map text</b>` and no `<b>` element;
- a wrong pickup code leaving the order `BOOKED`;
- the exact rider pill `Picked up` after the correct pickup code;
- manual location provenance, `ageSeconds < 60`, `stale=false`;
- the exact customer pill `Weighed in` after approving ₹360 for 6 kg;
- the exact operations pill `Ready for return` after care;
- unpaid delivery rejected with `PAYMENT_PENDING`, order still `RETURNING`;
- a wrong return code leaving the order `RETURNING`;
- the exact customer pill `Delivered`, money label `Paid at return`, amount
  `₹360.00`, persisted `DELIVERED/PAID/36000`;
- tracking read after delivery returning 404;
- a founder-resolved hold: `ON_HOLD` -> `RETURNING`, `totalMinor=0`,
  `paymentStatus=UNPAID`, exact label `Nothing due`;
- the hold order delivered with `DELIVERED/UNPAID/0`, no invented fee.

## Persisted results

Paid order `48c872fe-9b38-4a96-bfc1-113241f748b7`:

```text
status=DELIVERED  paymentStatus=PAID  totalMinor=36000
returnStatus=COMPLETED  trackingAfterDelivery=closed
pill="Delivered"  moneyLabel="Paid at return"  moneyAmount="₹360.00"
```

Held order `e9c0fde8-07a1-42f9-90fa-3bea177d98b9`:

```text
status=DELIVERED  paymentStatus=UNPAID  totalMinor=0
returnStatus=COMPLETED  moneyLabel="Nothing due"  moneyAmount="₹0.00"
```

Restart: API child PID `72360` -> `80826`; both SDK reads exited 0 with the
same states above. The reviewer order still reads `BOOKED/UNPAID`, version 1,
with the additive `timeZone`, `pickupEnd`, `returnEnd` and code-expiry fields.

## Supplementary manual proof

After the recorded run, a manual computer-use session completed order
`37a69188-e9bc-4a04-9936-748b25842892` at `DELIVERED/PAID`,
`totalMinor=36000`, `measuredWeightGrams=6000`, version 11. This is
supplementary proof from an interactive check. It is not part of run
`20261020191753`, is not one of the 17 hashed artifacts below, and does not
change the recorded result.

## CI-equivalent checks

Run on the isolated `laundry_verify_builder_20261021` database:
`pnpm install --frozen-lockfile`, `pnpm build`, `pnpm check`,
`pnpm check:convex`, `pnpm test`, `pnpm test:voice` all exited 0.

`pnpm test`: API 43 (23 legacy + 20 pilot), SDK 16, contracts 11, customer 8,
ops 11, partner 6. `pnpm test:voice`: 23.

Taste inspector: 0 FAIL, 0 WARN for customer, operations and delivery partner
at 1440, 768 and 390.

Directions: a live customer page returned
`https://www.google.com/maps/dir/?api=1&destination=12.975,77.642` with
`target="_blank"` and `rel="noopener noreferrer"`.

## Evidence files

All paths are relative to `docs/implementation/evidence/pilot/`. This directory
is gitignored.

| File | SHA-256 | What it records |
| --- | --- | --- |
| `01-customer-booked.png` | `e933b22f3a727c6120838c768317c1f64068b4d3740285666bd83a14058b6ddb` | booking, IST window, pickup code, steps |
| `02-customer-map-escaped.png` | `9ba8425ba6b9d5019ac34724a1bd5b20bd44a87c0884d1fedf129585dea32943` | escaped address in the map popup |
| `03-ops-assigned.png` | `b7c6256a8e135df0b091c4081d63f067a92b0347d5242b60b771b37b8db3c531` | operations queue, rider assigned |
| `04-rider-picked-up-and-position.png` | `243cd399a306aa8626d7b3b3783ff436a66100a44f4d6f36b550c7373e58a7ee` | pickup, intake, manual provenance |
| `05-customer-approved-price.png` | `714fbdd0ae42e7ae47ccc26ed89cdf10aba28686ab5bae4cba4b9e50bb20e296` | customer approves ₹360 |
| `06-ops-care-complete.png` | `7cff8502e7bae634adcb386295a3c54bb382416e2daaedc85fe46d873fa0705a` | care complete, ready for return |
| `07-rider-returning.png` | `e8e461eac7ad0fbe0793cdf73fa0bc22b0f23b19e51d898180507ca171402101` | return leg before payment |
| `08-ops-payment-recorded.png` | `1fa2f9ecc14a4683a4582478ffe63a7905c898e2cccb4d99cd959e3084cd60df` | manual payment receipt |
| `09-customer-delivered.png` | `8d1eb1fb4b41ca28cca297bbdd434801ac0e523484ff216efbe398ce20978611` | exact delivered/paid card |
| `10-ops-hold-resolved.png` | `3398dedd719415ebfae69055accba16dc08d1ffbbe443d5e33e83b81d5a16c90` | founder hold release |
| `11-customer-nothing-due.png` | `b414131cd130759eae9637f42b4fa9043b59b0e1ac2a5972706c5e8e65cc8188` | zero-total return |
| `pilot-flow.webm` | `8693159688360dc6d8f573c3dd1b09dbe3c66fc79756ab8b55725e4b6429b68b` | full browser session |
| `summary.json` | `91dbfd744345276c71e03a9b9f1f089ccd22810bea9c0d842a9d52d55d8f37b6` | run id, states, steps, warnings |
| `restart-persistence.log` | `efc925ebc0d987a50ec76801bb2312da898ee1a1dc6e31503d62417912496a55` | before/after restart SDK reads |
| `ci-equivalent.log` | `68d02cc0edaf63a6afc3e0e285bad5436ffb5497c1912aa883c6c529c4ad0ade` | install/build/check/convex/test/voice |
| `taste-inspector.log` | `3d2d367563035c5761442621ff93ff7457cdd709801e4ebd11ce3409ceeb792a` | three-role inspector results |
| `directions-check.log` | `7094d54f53f65d2910ebf9fff8ddc154071641f4c749d60c277421f4a7a7db3e` | external directions href |

`summary.json` records 0 `consoleErrors`. Its 30 warnings are filtered
`Failed to load resource` lines: expected 404s for closed tracking/optional
resources and 409s from the deliberate wrong-code and unpaid-return rejection
paths. There are no uncaught page errors. OpenStreetMap tiles are optional; a
blocked tile request does not change the reported coordinates or the checks.

## Fingerprint

`TREE_SHA=a5650c0dc36e3c15250e35ed12cae6bf4e3bf0b91012c4b6fc1c465d164bdb2e`

The hash is the SHA-256 of the tracked per-file manifest
`docs/implementation/pilot-fingerprint-inputs.sha256`. That file is the exact
`sha256sum` output for every input, in `LC_ALL=C` path order. Check every listed
file, then the list checksum:

```bash
sha256sum -c docs/implementation/pilot-fingerprint-inputs.sha256
sha256sum docs/implementation/pilot-fingerprint-inputs.sha256
```

To rebuild the per-file list and compare it with the tracked manifest:

```bash
{
  git ls-files -z
  git ls-files -z --others --exclude-standard
} | tr '\0' '\n' | LC_ALL=C sort -u \
  | grep -vE '^(docs/implementation/evidence/|\.taste-skill/|\.agents/|skills-lock\.json$|docs/implementation/pilot-fingerprint-inputs\.sha256$|docs/implementation/pilot-backend-mvp\.md$|docs/implementation/pilot-review-disposition\.md$|docs/implementation/pilot-evidence-manifest\.md$)' \
  | while IFS= read -r f; do [ -f "$f" ] && sha256sum "$f"; done \
  > /tmp/pilot-fingerprint-inputs.sha256

diff -u docs/implementation/pilot-fingerprint-inputs.sha256 \
  /tmp/pilot-fingerprint-inputs.sha256
```

The three handover documents and the tracked input manifest are excluded, so
the value does not self-reference. Ignored evidence and local skill tooling are
also excluded. The list includes non-ignored untracked files, so the hash
matches only when the listed paths are the ones committed.

### Fingerprint incident

The earlier `b1452fbd5b24991538528636a37282e0cf705b8304ff2135cc54a07d27730ce1`
value covered the pre-repair input paths and contents. The original command used
`sort -u` without a fixed collation. Under the ambient `en_IN`/`en_US.UTF-8`
ordering it produced `b1452f...`; under `LC_ALL=C` the same inputs produced
`695a3c2c888a0509ccb37b95029cfbfc5d255f1b67a3dacba998de6ec1f50534`. The
recorded value was correct for that locale, but the command was not portable.
All 17 evidence artifact hashes above match the current files. The mismatch was
in the algorithm, not input drift.

This repair then added `.agents/` and `skills-lock.json` to `.gitignore`. That
deliberate input change moves the final hash from `695a3c...` to
`8e4d0731...`. The per-file manifest records the post-repair inputs.

## Limits

- Rates are unapproved placeholders; payment is recorded by hand; no gateway,
  SMS, WhatsApp, live GPS attestation or real delivery is claimed.
- The shared browser DB accumulates QA orders from repeated evidence runs. It
  was not truncated. The reviewer DB and order were not touched by the script.
- Migration `005_pilot_windows.sql` additively backfilled existing pilot orders,
  including reviewer order `088fa2e3`; status, payment and version are
  unchanged. See `restart-persistence.log`.
- No merge, deploy, paid provider call or edit to the dirty
  `/home/batman/Projects/code/Landary` checkout was made.
