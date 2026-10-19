# Agent workflow setup verification

20 October 2026. Tooling is implemented on `chore/cloud-agent-workflow`, isolated from the original dirty checkout. Product approval remains pending both founders.

## Executed checks

- Frozen pnpm install and workspace build/type checks passed.
- All 73 existing workspace tests passed against a private loopback PostgreSQL 17 instance.
- Seven tooling behavior tests passed: issue packets, exact executor/model, missing cloud environment, provider/partial errors, stale/tampered/missing media and database isolation.
- Convex type checks and 23 voice utility tests passed.
- Three actual web smoke flows passed with videos and traces: customer demo/catalog/quantity/basket; rider demo/assigned tasks; operations demo/service catalog.
- The precommit browser run was diagnostic with a dirty workspace. A clean committed-revision run and CI evidence must accompany the PR. It does not verify Android hardware, payment integration, complete booking fulfillment or Codex Cloud execution.

## Actual OpenCode role probes

Both configured roles were invoked through the repository runner using exact `openrouter/meta/muse-spark-1.3`, without substitution:

- `laundry-planner`: session `ses_eaa7be4d9ffetgFGphMQFFkRWb`, exit 0.
- `laundry-tooling`: session `ses_eaa76b870ffe0HvRi2am3sQwJ9`, exit 0 after an initial quota reservation rejection and serial retry.

These bounded probes requested no repository tools or implementation. They establish role invocation, not independent code review or browser verification. Earlier planning delegation receipts are in ../plans/laundry-app/AGENT-RUNS.md. Coordinator performed local standards and requirements review; no external Claude review was available.

## Delivery and remaining setup

CI records each pushed revision and retains videos, traces and a SHA/hash manifest. Missing or failed evidence fails its job; branch protection is not configured, so this workflow is not yet a mandatory GitHub merge rule. Attach a current video to each PR for inline review, as described in ../agents/README.md.

The user explicitly deferred Codex Cloud sign-in and Laundry environment configuration until after the tooling push. No Laundry cloud environment or successful cloud task is claimed. `cloud:submit` rejects a missing environment, uncommitted work or an unpublished baseline. Native Android proof and the first real cloud execution remain later setup checks.
