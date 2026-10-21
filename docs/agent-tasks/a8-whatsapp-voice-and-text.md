# A8: WhatsApp voice and text

**Goal:** Implement signed webhook ingestion, private media access, transcription adapter, schema extraction, clarification, consent/linking, confirm/pay flow and human handoff. Document voice-note scope. Evaluate vendor/language support with consented fixtures; no model can invent prices.

**Read first:** [Product spec](../specs/product-spec.md), [shared contracts](../specs/contracts.md), [main plan](../superpowers/plans/2026-10-11-laundry.md).

**Depends on:** A0 contracts-v1. Fixtures permit independent development after the A0 gate; they do not prove cross-module integration.

**Write allowlist:** `modules/conversations/**`. A0 alone edits shared contracts, manifests, lockfile, generated SDK, canonical migrations and app/worker composition. For A0, its exact allowlist is the main plan's shared/root paths. Do not commit edits to another packet's paths. Use a separate worktree/branch.

**Create paths:**
- `modules/conversations/src/webhook.controller.ts`
- `modules/conversations/src/draft.service.ts`
- `modules/conversations/src/voice.worker.ts`
- `modules/conversations/src/speech.port.ts`
- `modules/conversations/src/notifications.worker.ts`
- `modules/conversations/schema/proposal.sql`

**Interfaces:** Implement ConversationPort with injected OrdersPort/CatalogPort/SpeechPort. Export ConversationsModule. DraftConfirmation binds draftId/revision/quoteId; outbound order notices consume order.updated.v1 and refund.updated.v1.

## Implementation tasks

- [ ] Create `modules/conversations/test/voice-booking.test.ts` with individually named behavior tests for these assertions: duplicate audio yields one draft; tomorrow uses receipt timezone; ambiguous five clothes asks garment types; revision mismatch cannot confirm; repeated confirmation reuses checkout; prompt injection cannot call arbitrary tools; outside-window notice needs approved template; failure deletes audio on schedule. Assertions must exercise observable state, API results and ledger/job counts rather than implementation details.
- [ ] Run `pnpm --filter @laundry/conversations test` and confirm the new cases fail for the intended missing behavior. A0 first creates these workspace scripts; do not interpret “script missing” as a useful regression result.
- [ ] Implement the interfaces and behavior above in the owned paths. Keep adapter, persistence and handler concerns separate. Every public command must honor actor authorization, idempotency and version rules from contracts.md.
- [ ] Add module-local schema proposals where applicable; send them to A0 for canonical migration integration. Request shared contract/dependency changes explicitly; never patch a private workaround into a consumer.
- [ ] Run `pnpm --filter @laundry/conversations test` until all behavior cases pass, then `pnpm check` and `pnpm test:contracts`. Mark checks that require unmerged dependencies as pending, not passed. Backend packet tests use real isolated Postgres, with only external providers mocked.
- [ ] Commit only owned paths with message `feat: implement a8 whatsapp voice and text`. Return commit ID, changed files, commands/results, fixture vs live evidence and remaining dependencies to A0. Do not merge, deploy or publish on your own.

## Definition of done

Every assigned behavior and test above is implemented; no writes escape the allowlist; schemas match contracts-v1; fixtures contain no real personal data or secrets. Empty/loading/error/permission states are covered for UI packets. Provider-dependent work is explicitly labeled simulator/sandbox/live. Handoff is incomplete if it omits an untested dependency, unsupported provider capability or migration requirement.
