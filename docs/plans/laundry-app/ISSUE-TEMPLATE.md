# <Short title describing a verifiable user outcome>

Status: draft — create issues only after plan and breakdown review.

## Approved context

- Plan: <repo-relative link, version and commit>
- Requirements: <stable IDs and relevant sections>
- Current behavior: <concrete observed starting point>
- Desired behavior: <concrete trigger and result>
- Design: <committed mockup/screenshots/components when relevant>
- Agent guide: <repo-relative link>
- Existing task packet/contracts/ADRs: <relevant links>

## What to deliver

<One bounded, demoable behavior. Reuse existing functionality wherever possible.>

## Acceptance criteria

- [ ] Given <state>, when <action>, then <observable result>.
- [ ] Given <important edge case>, then <expected recovery/validation>.
- [ ] Required UI states and accessibility behaviors are demonstrated where relevant.

## Scope boundaries

<Included surfaces and behaviors; explicit exclusions that would otherwise be ambiguous.>

## Blocked by

<Issue links and integration requirement, or “None.” Use native blocking relationships when available.>

## Verification

<Applicable repository commands, behavior scenarios, viewport expectations, test fixtures/services, and required evidence. Distinguish checks the worker can run from external prerequisites.>

- Browser/computer acceptance journey to perform and record: <specific actions and expected results>.
- Evidence: current-revision watchable video, criterion-to-result/timestamp map, checks and supporting traces/logs.
- Identity: head SHA, base SHA, actual tested SHA and CI run/attempt. A new push supersedes old evidence.
- Required delivery: isolated issue branch + PR. Keep review blocked until required current evidence exists. Read `VERIFICATION.md` in this planning folder.

## Delivery and ownership

- Target repo/branch: <confirmed baseline>
- Permitted output: <approved branch/PR policy>
- Merge/deploy authority: <explicit policy>
- Shared contract/file ownership: <only where overlapping work requires it>

## Ready gate

The requirement is approved, no blocking product question remains, prerequisites are integrated, design context is retrievable, and the verification environment is available. A draft or approval label does not itself prove these conditions.
