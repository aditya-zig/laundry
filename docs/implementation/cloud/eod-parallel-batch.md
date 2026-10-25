# EOD parallel candidate-repair batch — 25 October 2026

The operator requested full-project parallel work and speed without weakening
software quality. This batch preserves the recovered unfinished backend source
instead of discarding or silently calling it complete. Baseline is
`16eddf74e29945932a8042d2aae88c944ea6c9f1`; its Laundry checks 40191702141 and Agent
verification 40191702134 both completed successfully before this push. The older
Agent verification 40191468182 for 10e445b was cancelled, not passed.

## Execution and authority

`.github/workflows/cloud-workers.yml` launches isolated GitHub-hosted workers,
with one private PostgreSQL service and checkout per task, maximum three active
workers, bounded process/job lifetimes, read-only repository permission, no
checkout credentials, no production secrets and no automatic merge/deployment.
Only `opencode/glm-5.3-flash-free` is permitted, including auxiliary requests;
its actual CLI model metadata must show zero input/output/cache prices before
invocation. There is no paid fallback or blind retry after provider limits.
The pinned OpenCode runtime is 1.19.4, independently installed on each runner.

This is maintenance/review of inherited **unintegrated candidate code**, not a
claim that the C01 freeze or all P01 feature-dispatch prerequisites passed.
Contract mismatches stop affected work and return change requests. Production
ordering/readiness stay disabled. Feature/source/tested SHAs and evidence cannot
be inferred from an agent's completion message.

Ownership is executable in `tools/agents/cloud-batch.mjs`. B05 billing, B06
logistics, B08 support/reviews, B09 conversations and B10 durability own disjoint
feature/test/proposal paths. D01 owns shared design candidates/reference screens.
C01, F00 and E02 are read-only audits with a single report path each. B07 is not
relaunched; the coordinator reviews its retained media candidate and integrates
shared migrations/composition. No worker writes contracts, root manifests, CI,
canonical migrations or app routes. Actual changed paths are checked before a
review patch is exported. Shell permissions are defense in depth, not a sandbox;
patches remain untrusted until coordinator review and integrated acceptance.

Each job returns its actual terminal process result, selected-model metadata,
source SHA, candidate OpenAPI digest, changed paths, patch digest, report and
failure evidence in access-controlled workflow artifacts. Partial source stays
available even if a task hits a provider/time limit; failure is never completion.
No worker has permission to commit, push, open PRs, or activate providers.

## Critical path

1. Review/repair money, custody, media and worker invariants; reconcile candidate
   contract changes centrally and integrate canonical schemas/composition.
2. Run actual SDK/API/PostgreSQL whole-product flows and concurrency/restart
   regressions. Include staff MFA/session revocation before staff activation.
3. Integrate shared session/retry foundations and customer, rider and operations
   app consumers after route/design ownership is stable. Keep legacy semantics
   and pending/unknown/offline behavior explicit.
4. Build and publish an explicitly staged candidate to Laundry-owned resources;
   exercise actual screens and preserve readable clean-SHA evidence. Native
   validation is separate from responsive web.
5. Report exact verified scope and blockers. EOD urgency does not supply rates,
   areas, capacity, care/refund approvals, provider authority, physical-pilot or
   native evidence. The existing node-forge audit finding is not waived.
