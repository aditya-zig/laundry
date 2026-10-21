# R01 handoff: LaundryMate public reference investigation

## Identity

- Task ID: R01
- Task name: laundrymate-reference
- Worker branch: `cloud/r01-laundrymate-reference`
- Base SHA: `f0efdc0` (the P00 integration baseline)
- Source branch: new implementation
- Source SHA: not applicable
- Tested SHA: see the final record
- Contract digest: `sha256:b6af0b88d2e163fa675e827a633d698e4d43a7824b03f84cc232239ebb30a285`
- Contract scope: `packages/contracts`
- Integration target: `cloud/P00-source-consolidation`
- Status: IMPLEMENTED

## Purpose

This task produced an evidence-backed reference study of LaundryMate's public web presence and shipped client artifacts, and turned it into an original, prioritized requirement list for Laundry. Every claim is classified as observed UI, static client evidence, inference or unknown, and the native and authenticated parts are recorded as unknown rather than guessed.

## File ownership

| Path | Action | Reason |
|---|---|---|
| `docs/research/laundrymate/REFERENCE-ANALYSIS.md` | added | The reference analysis, feature matrix, provenance ledger and prioritized requirements |
| `tools/research/laundrymate/capture-public.sh` | added | Repeatable capture of the public surface with digests, writing outside the product source tree |

## Source provenance

| Behavior | Source branch | Source SHA | Integration action |
|---|---|---|---|
| Service taxonomy | LaundryMate public site | n/a | preserved as a reference, not copied |
| Price list structure | LaundryMate public site | n/a | adapted into a Laundry requirement |
| Membership shape | LaundryMate public site | n/a | deferred with a recorded reason |
| Sign-in and support flows | LaundryMate public site | n/a | adapted into Laundry requirements |
| Technology observations | LaundryMate client bundles | n/a | recorded as reference evidence |

## Contract changes

- Changed contracts: none
- Compatibility impact: none
- API changes: none
- Migration changes: none
- Idempotency impact: none
- State transition impact: none

## Contract digest command

Command:

```
git ls-tree -r <tested-SHA> -- packages/contracts | sha256sum
```

Recorded digest:

```
sha256:b6af0b88d2e163fa675e827a633d698e4d43a7824b03f84cc232239ebb30a285
```

## Verification

| Command | Exit code | Evidence |
|---|---|---|
| `bash -n tools/research/laundrymate/capture-public.sh` | 0 | Shell syntax check |
| `curl` capture of the eight public routes | 0 | HTTP 200 for each route, recorded in the analysis file |
| `sha256sum` of the five downloaded client artifacts | 0 | Digest table in the analysis file |
| `npx -y rea-agents@6.7.0 analyze-javascript-application <bundles> --json` | 1 | `provider_timeout` after 300 s on the 2.8 MB obfuscated bundle, with a retained partial Evidence record |
| `npx -y rea-agents@6.7.0 analyze-javascript-application <bundles> --source-path main.*.js --analysis-timeout-ms 900000 --json` | 1 | `provider_timeout` after 900 s. Partial Evidence retained. 205 webpack modules, 1326 findings, 482273 AST nodes visited, 0 parse failures. Evidence `ev_8ae4696a0454f5c5538deb2fb991c4e1d9cb1e51ce3ce31f23fef8aabd3d9469` |
| `npx -y rea-agents@6.7.0 analyze-javascript-application <bundles> --source-path scripts.*.js --analysis-timeout-ms 600000 --json` | 0 | Completed. 38682 AST nodes visited, 0 parse failures, 0 findings. Evidence `ev_1bc58b638239a702f069a4184150ce49c71f64ef2cbbbe705594301cd1cf0d82` |

## Runtime prerequisites

- Package manager: pnpm 10.33.2
- Required services: none. The research is static plus a browser.
- Database: not required
- Environment variables: none
- Setup command: `npx -y rea-agents@6.7.0 doctor --client codex --json`
- Test command: `bash tools/research/laundrymate/capture-public.sh /tmp/laundrymate-capture`

## Test results

| Suite | Result | Evidence |
|---|---|---|
| Public route capture | passed | 8 routes, HTTP 200, digests recorded |
| Client artifact inventory | passed | 5 artifacts, digests recorded |
| REA static analysis of the full bundle tree | failed | provider_timeout, partial Evidence retained |
| REA static analysis of `main` with a 900 s timeout | failed | provider_timeout, partial Evidence retained with 205 modules and 1326 findings |
| REA static analysis of `scripts` | passed | Evidence `ev_1bc58b638239a702f069a4184150ce49c71f64ef2cbbbe705594301cd1cf0d82` |

## Known failures

| ID | Symptom | Reproduction command | Owner | Blocking |
|---|---|---|---|---|
| R01-KF-01 | REA times out parsing the 2.8 MB obfuscated `main` bundle at the default 300 s analysis timeout and again at 900 s. The partial Evidence is retained and reports 205 webpack modules and 1326 findings. | `npx -y rea-agents@6.7.0 analyze-javascript-application <bundles> --json` | R01 | No |
| R01-KF-02 | Native Android analysis is not possible. No APK was supplied, no device is attached, and JADX, Ghidra, Hopper, IDA and Kuna are not configured on this machine | `npx -y rea-agents@6.7.0 doctor --client codex --json` | R01 | No |
| R01-KF-03 | The membership table's quarterly, half-yearly and annual prices and the offers page cards are not present in the captured text layer | `bash tools/research/laundrymate/capture-public.sh /tmp/laundrymate-capture` | R01 | No |
| R01-KF-04 | The authenticated application, the rider application and the backend contract are unknown | not applicable | R01 | No |

## Conflicts and decisions

| Conflict | Decision | Decision owner | Evidence |
|---|---|---|---|
| The REA run timed out on the obfuscated bundle | The static findings come from direct inspection of the downloaded artifacts, which is sufficient for the claims made. The REA outcome is recorded honestly rather than presented as a completed analysis. | Coordinator | `docs/research/laundrymate/REFERENCE-ANALYSIS.md` section 10 |
| The reference contains competitor prices | Only the structure is used. No Laundry rate is derived from a competitor price. | Coordinator | Section 6 of the analysis |
| The reference contains a public refund promise | Not adopted. Laundry's refund policy is still an open founder decision. | Coordinator | Section 11 of the analysis |

## Preservation checks

- [x] No changes outside assigned ownership
- [x] Canonical namespace preserved
- [x] Existing functionality retained
- [x] Protected assets unchanged
- [x] No unreviewed migrations
- [x] No new competing persistence authority
- [x] No secrets committed
- [x] Required tests executed
- [x] Known failures disclosed

## Integration instructions

1. `git fetch origin cloud/r01-laundrymate-reference`
2. `git checkout cloud/r01-laundrymate-reference`
3. Read `docs/research/laundrymate/REFERENCE-ANALYSIS.md`, then apply the section 12 requirements to the owning tasks.
4. No migration, contract or composition change is required, so the coordinator can merge this branch without rerunning the product suites. A read of the document and a diff check are enough.

## Final record

- Base SHA: `f0efdc0`
- Source SHA: not applicable
- Tested SHA: recorded in the branch tip at handoff time
- Contract digest: `sha256:b6af0b88d2e163fa675e827a633d698e4d43a7824b03f84cc232239ebb30a285`
- Last verification command: `bash -n tools/research/laundrymate/capture-public.sh`
- Last verification exit code: 0
- Remaining blockers: none. Four known failures are recorded above, all of them explicit unknowns or a recorded tool timeout.
- Pull request created: no
- Ready for coordinator integration: yes
