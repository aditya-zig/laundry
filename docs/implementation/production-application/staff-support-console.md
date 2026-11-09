# Staff support console — task-scoped implementation

Status: targeted, task-browser and clean-revision integration verification passed. Not a deployed/staffed support service.

## Boundary and behavior

- Additive v2 read `GET /v2/ops/incidents`, via `@laundry/api-client.listOpsIncidents`. OPERATOR/SUPPORT/ADMIN are allowed; customer/rider/facility/anonymous callers cannot enumerate it. The owned customer list remains separate and filtered by customer id.
- Cases use bounded keyset pages, ordered by opening time, not unread priority. Migration `021_support_staff_queue.sql` adds the matching global queue index without rewriting migration 017. Review/schedule ordinary transactional index DDL before deployment to a busy database.
- Support-only staff do not mount/request the fulfillment queue. Existing fulfillment and read-only catalog views remain available to their permitted roles.
- Text replies use the existing authenticated incident-message command and actor/scope-filtered journal. Retained body/case/key are immutable; ambiguity, corruption or a missing retained key blocks replacement. No automatic replay, case resolution/reopening, refund, delivery or notification is implied.
- Read failures are not empty results. Missing/non-advancing continuation is rejected, and staff must load the remaining thread before a new reply. The console has no media viewer, assignment, SLA/unread automation or staffed-hours promise.
- The same task-owned ops context/video is retained through fulfillment and the later support exchange; explicit closure flushes its recording. The canonical product journey selects actual staff UI rather than the synthetic service acknowledgement fallback.

## Verification

Two new HTTP cases first failed with missing-route 404s (expected 200/400); the SDK pagination test failed `client.listOpsIncidents is not a function`. Corrected boundary run `bf53ac0bb` passed contracts 104, SDK 165 and the 16-case PostgreSQL/HTTP support/review suite. Role denial, customer ownership, opaque pagination, validation/no-store and unchanged order status/version are covered there.

`b07f40efb` passed 56 focused console/host tests and ops typecheck. `bffbedfad` passed rebuilt API/ops, all 16 HTTP/PostgreSQL tests including index 021, and the actual customer→operator-console→customer exchange within the full product journey. One operator message survived committed reply loss/retry with the same key/body; queue/thread GET 503s were not rendered as empty, and no order version/status changed. Mobile/desktop support screenshots were inspected; no horizontal overflow or browser runtime errors were reported. The initial contract metadata check correctly rejected stale OpenAPI; regeneration and all seven executable OpenAPI checks then passed.

The broader dirty-tree integration batch finished on 27 October 2026 with exit 0: workspace build, root typecheck (pnpm check), Convex compatibility, contracts/OpenAPI checks, the PostgreSQL-backed workspace suite inside an owned disposable Docker database (label support-checkpoint, `acceptance command exited 0`), and 121 tooling tests, ending with a clean `git diff --check`. Suite totals on that run: API 373, SDK 165, foundation 55, customer 126, partner 55, ops 87, contracts 104, fixtures 237, tokens 2. An earlier background attempt of the same batch was killed mid-Metro-export and is not a pass. The batch ran on uncommitted slice content, so a clean-revision four-role journey plus private recording/restore archive remained open. That follow-up is recorded: `clean-revision-checkpoint-20261109.md` holds the `e41049b` four-role journey (including this console's browser exchange with `staffConsoleBrowserProven`, non-empty failed reads and the same-key/body staff reply), the customer-v2 restore rehearsal and the 1080p original recording, all on a clean tree with digest indexes.

Provider identities, prices and custody/payment facts remain explicitly synthetic; native and real partner/provider gates stay open.
