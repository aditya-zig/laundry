# Follow-up implementation lanes

The first isolated cloud run is finished. It returned useful defects and patches,
but its 45-step allowance was too small for the broad briefs: most lanes ended
in investigation or partial work. D01 failed ownership. None of those incomplete
results is a verified task. Coordinator integration/results are recorded in
`eod-backend-integration.md`.

The next bounded cloud snapshot runs only three independent implementation lanes:

- B01: enforce staff OTP + enrolled TOTP and bind privileged session families to
  staff/MFA identity. New proposal `B01-staff-sessions.sql`; coordinator alone
  assigns canonical migration 019. The shared wire now accepts optional
  `OtpVerify.mfaCode` and the existing SDK verification method forwards
  `opts.mfaCode` in the body; old customer requests remain byte-compatible.
  This additive field alone does NOT enforce MFA. Production staff activation
  remains blocked until the actual implementation and acceptance pass.
- D01: implement the existing Framed sheet design candidate, tokens and reference
  screens. Draw output must be under its owned design directory, inspection
  artifacts under ignored task evidence, not an unowned `.taste-skill` file.
- F00: implement a shared pure-TypeScript session/retry foundation candidate and
  new v2 adapters for all three apps. Ownership is explicitly expanded to the new
  `packages/app-foundation/**`, the three `src/foundation/**` directories and
  `src/api-v2.ts` files. Existing v1 adapters, app routes/layouts and root
  manifests/lockfiles remain coordinator-owned and are not overwritten.

Shared candidate schemas are coordinator-owned and the runner pins their actual
OpenAPI digest. No approved general contract/design freeze is inferred. These
are candidate remediation lanes, not a claim that blocked feature-dispatch or
whole-product release gates have been waived.

Each worker has up to 140 agent steps within the same bounded 14-minute process
and 22-minute job. No hard tool/usage budget is applied. Briefs require an early,
incrementally updated handoff instead of leaving all evidence until the end.
The runner now explicitly rejects a terminal step-exhaustion message even if the
CLI exits zero. Partial patches/failures remain available for review; there is no
paid model fallback or blind provider-limit retry.

The coordinator continues API/app/deployment integration independently. No worker
may push, deploy, touch another lease, invent a launch policy, or substitute
simulated fulfillment for real production evidence. Readiness remains disabled.
