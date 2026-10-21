# Cloud-only execution protocol

Read this before claiming a task. Read [IMPLEMENTATION.md](IMPLEMENTATION.md), [CONTRACTS-V2.md](CONTRACTS-V2.md), your packet in `issues/`, the repository AGENTS.md and the old domain packet linked by your issue. Dispatch metadata lives in [TASKS.json](TASKS.json); published links live in [ISSUES.md](ISSUES.md).

## Coordinator sequence

1. Verify Laundry's cloud account, GitHub access, environment publication and artifact access. An issue is a queue item, not a launched agent. Dispatch only authorized cloud jobs; do not substitute local child agents. Provider/model spend still needs explicit authorization.
2. Run P00 and R01 independently. P00 reconciles the three pinned source refs, preserves behaviors and skills, removes automatic production deployment from the integration path, publishes a named integration branch and inventory of routes/registries/legacy adapters. P00 may not discard either product branch or silently overwrite unrelated changes.
3. Serialize coordinator work P01 and C01 where roots overlap. D01 can work concurrently in its owned design directories. Publish the runtime guide, verified fresh-cloud preflight, exact commands, contract digest, integration SHA and design freeze.
4. For every runnable task, acquire a lease in its GitHub issue: task ID, named cloud worker, base SHA, contract digest, ownership, start time and heartbeat deadline. A suggested heartbeat interval is 15 minutes with a 45-minute lease; coordinator confirms worker/process termination before replacing an expired lease. No two workers write the same path.
5. Launch independent B01–B10 and F00 only after their start blockers are integrated. Then launch F01–F04 after F00 freezes app shells. Integration dependencies can still be in progress, but end-to-end completion waits for real peers.
6. Review each delivered SHA, ownership diff, schema proposal and evidence. Integrate canonical migrations/composition changes, rerun affected producer/consumer checks and publish a new baseline. Use ordinary commits and pushes; no PRs or forced history changes. Keep production promotion separate.
7. Run E01 and E02 on the same pinned integrated candidate; any candidate change requires impacted revalidation. E03 collects remaining business/provider/physical-pilot gates honestly.

## Ownership and changes

Each packet's allowlist is exclusive for its lease. Read any source; write only allowed source plus `docs/implementation/handoffs/<TASK>/` and its own schema proposal. Coordinator alone owns root manifests/lockfiles, shared tsconfig/build/CI/environment infrastructure, canonical `modules/schema/migrations/**`, `packages/contracts/**`, `packages/api-client/**`, `packages/test-fixtures/**`, API composition/legacy bridges and shared infrastructure registries. P01 and C01 are coordinator tasks and are serialized.

D01 owns `packages/design-tokens/**` and new `packages/ui/**`; dependencies/exports touching root manifests go through coordinator. F00 owns app layouts, root shell, SDK/session/navigation wiring and the route ownership map. It freezes those before screen tasks begin. Subsequent route changes are requested through F00/coordinator. The initial packet paths are explicit; if P00 discovers a renamed route, coordinator updates the manifest and packet before dispatch, without creating overlapping aliases.

Backend workers own feature controllers under `apps/api/src/features/<feature>/**` and their named module directories. They return registration descriptors for coordinator integration. Legacy controller/module files stay coordinator-owned unless a published ownership amendment transfers an exact file. B08 uses new support/review modules rather than editing support code inside B04's legacy orders module. B10 owns worker code but shared outbox/idempotency storage remains behind C01's infrastructure ports.

Schema proposals belong in `modules/schema/proposals/<TASK>.sql`. A feature may apply its proposal only to its private test database using the harness. Coordinator assigns canonical sequence numbers, reviews constraints/backfills and runs the integrated migration chain before acceptance. No destructive rewrite of applied migrations. Handoffs flag whether evidence used proposals or canonical migrations.

For a shared change, send a change request on your issue with exact schema/path, reason, affected consumers and a failing example. Keep unrelated work moving. Coordinator publishes an additive revision or pauses affected tasks for a breaking freeze. Request ownership expansion before writing outside the allowlist.

## Worker recipe and stop conditions

- Fetch the published branch and verify the exact base SHA exists. Create `cloud/<task-id>-<short-name>` from that SHA. Verify the contract digest and environment runtime/lockfile against the dispatch record; refreshed dependencies come from the lockfile, not another worker's cache.
- Use a private database `laundry_verify_<task>_<run>` and task-local ports/artifacts. Run the canonical preflight from P01. Missing Postgres, cloud browser, skill, source ref or artifact upload means `BLOCKED_ENV`; do not replace a required capability with a simulated pass.
- Implement the packet in small reviewed steps, beginning with meaningful failing behavior tests for engineering work. Research/design tasks produce evidence/review artifacts instead of artificial test coverage. Provider fakes are allowed only at external boundaries and are labeled.
- Stop affected work for absent contract/business/provider decisions. Implement disabled configuration and adapters where independent. Record `BLOCKED_CONTRACT`, `BLOCKED_BUSINESS` or `BLOCKED_PROVIDER` with the missing input and exact resume condition. Never put credentials or private customer artifacts into issues.
- Run scoped tests, then required shared consumer checks. Inspect actual apps for UI acceptance. Verify process exit status directly; a detached launcher printing success is insufficient. Shut down only your own processes.
- Commit only the allowlist, push the cloud task branch and publish the handoff below. Never claim integration from fixture tests or a completion message. Coordinator must fetch the pushed SHA and rerun integrated checks.

## Handoff record

Write `docs/implementation/handoffs/<TASK>/HANDOFF.md` and `evidence.json`. Include task/issue/worker, base/source/tested SHA, contract version/digest, design version, branch, changed files, schema proposals/registrations, exact command argv and exit codes, scenario results, provider modes, known failures and dependencies. Evidence lists stable access-controlled artifact URLs, SHA-256, bytes and media metadata. Store raw videos/traces outside git. Preserve failing evidence with a failure reason. Bind build artifacts to tested SHA; pushing later source changes invalidates the previous evidence.

States: `READY`, `RUNNING`, `IMPLEMENTED`, `INTEGRATED`, `VERIFIED`, or an explicit blocker/failure. Coordinator records the integration SHA and evidence before moving to `VERIFIED`. Reopening a blocker requires changed evidence/input, not a timeout.

## Copy-paste cloud dispatch prompt

```text
Implement task <ID> from GitHub issue <URL> in aditya-zig/laundry.
Cloud environment: <published environment ID/version>.
Base: <integration branch>@<immutable SHA>.
Contract: laundry-wire-v2.0.0@<digest>; design: <D01 freeze>.
Read AGENTS.md, docs/implementation/production-application/CLOUD-AGENTS.md,
IMPLEMENTATION.md, CONTRACTS-V2.md and issues/<ID>.md before editing.
Use only this cloud checkout and the task allowlist. Acquire/renew the issue
lease; do not launch local subagents. Use a private PostgreSQL database.
Deliver cloud/<id>-<name>, pushed SHA and the required handoff/evidence.
No PR, production deployment, paid provider/model call or secret publication.
Report missing capabilities as explicit blockers. Simulator checks cannot
certify production providers or native Android behavior.
```
