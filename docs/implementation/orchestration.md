# Implementation orchestration

User authorized implementation, private GitHub repository creation, commits and push. No deployment has been requested. All additional model calls are restricted to zero-priced models or confirmed included free quota; no credit purchases or paid fallback.

## Ownership

| Lane | Provider/model | Writes |
|---|---|---|
| Main coordinator | Current session | Root manifests/lock, infrastructure, CI, ledger, README, commits/push |
| UI second orchestrator | OpenCode Muse Spark 1.3 Contributor Free | Customer/partner/ops apps and UI handoff |
| Backend | OpenCode MiMo V2.6 Flash Free | API, worker, modules, backend integration tests |
| Local voice transcription | Antigravity Gemini 3.8 Flash Medium, included quota | tools/voice-transcriber, speech handoff |
| Service illustrations | Freebuff, displayed free balance | assets/services, asset manifest/handoff |
| Independent foundation verification | OpenCode Muse Spark 1.3 Contributor Free | Shared packages, tsconfig fixes, verification report |
| Final verification | OpenCode Muse Spark 1.3 Contributor Free | Integration/browser evidence and scoped repairs after ownership handoff |

Each lane uses explicit file boundaries. Shared schemas were established before app work; additions must preserve existing wire shapes. Root dependency installation belongs to the coordinator. The UI orchestrator may delegate its app directories, but must supervise foreground processes and read completed results. Interrupted processes are resumed from saved sessions; detached children are not considered successful.

## Current agent split (2026-10-11)

- Backend worker: orders/billing/logistics/conversations — owns apps/api, apps/worker, modules.
- UI verifier: customer/partner/ops — owns apps/customer, apps/partner, apps/ops.
- Speech: tools/voice-transcriber — owns local Whisper wrapper and speech handoff.
- Coordinator owns root manifests/lock (package.json, pnpm-lock.yaml, root config/infra) plus ledger, README, commits/push.

Cline currently points to a missing binary. Copilot is installed, but this account's no-charge model access has not been established. Neither is allowed to silently incur paid usage. Firstmate is present as workflow material rather than a callable agent CLI.

## Completion evidence

Foundation tests do not prove the apps are complete. Final completion requires actual typechecks/builds, PostgreSQL-backed integration tests, browser/computer-use checks, explicit demo labeling, reproducible setup instructions, a committed clean tree and a pushed remote commit. Missing commercial credentials must be reported precisely. Real billing, WhatsApp sending and third-party dispatch must never be represented as working when only simulators are exercised.
