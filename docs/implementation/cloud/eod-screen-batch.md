# Isolated screen implementation batch

Coordinator amendment: this is candidate implementation, NOT dispatch against frozen C01/D01/P01 or completed F00 gates. Target remains laundry-wire-v2.0.0-candidate; digest is computed by each runner from the committed OpenAPI. No production approval or release follows from this snapshot.

## Exclusive lanes

- F01: customer home/services/basket/checkout and owned booking helpers/tests.
- F03: rider task/detail/history/account and owned feature helpers/tests.
- F04: operations feature/pages/styles; exports ProductOperationsApp for parent mounting.
- E03: bounded read-only deployment/security critique; writes only its audit handoff.

Exact allowlists/briefs are in tools/agents/cloud-batch.mjs. Disposable GitHub checkouts, three workers concurrent, zero-cost-model check, no inherited credentials, no paid fallback, no commit/push/deploy authority. E03 queues until a slot is available. Existing completed B01/D01/F00 lanes are not duplicated. Coordinator owns shared sessions, API/SDK/contracts, root manifests/lock, app layouts/mounting, infrastructure and acceptance.

Parent prerequisite checks on this dirty candidate: pnpm check passed; contracts, SDK and new foundation build passed; 22 rewritten/expanded session tests passed; four runner tests passed. Initial inherited foundation suite failed 13/15 and was not accepted. Intermediate typecheck failed on synthetic fixture types and was corrected using authoritative schema parsing. A max-parallel=4 edit tripped the existing runner assertion; kept the existing bounded three-worker limit. No failing exit was hidden.

Integrated B01 includes staff MFA/session binding plus parent cached-login, cached-refresh and relaxed-session rejection repairs. Runtime role gets SELECT, not provisioning writes, on identity_staff/identity_staff_facilities. Earlier focused PostgreSQL/API/bridge run passed 40 tests; source has changed since, so that is not release approval. Canonical migration 019 carries staff binding. Node HTTP Fetch bridge is tested but not deployed.

Foundation now journals refresh retry identity before rotation, restores from injected stores, retains immutable known-command DTO/key across unknown outcomes and process restarts with persistent adapters, coalesces duplicate clicks, rejects stale identity scope and invalidates private caches. Browser defaults are MEMORY ONLY, not offline/native persistence acceptance. Apps require explicit v2 URL; no implicit legacy/demo fallback. Native secure storage and secure UUID injection remain host responsibilities. Public OTP verification does not require a prior session. These additive adapters are not proof screens have migrated.

D01 documents/reference HTML are retained as candidate design inputs only, not actual app/browser evidence. F00's timeout/partial worker handoff is historical, not current completion authority; parent substantially repaired its source. Existing product gates, dependency-security failure, provider/commercial/business/native/physical blockers remain. Parent reviews actual process completion and patches before integration, then browser/DB evidence on a clean SHA. No production deployment occurred.
