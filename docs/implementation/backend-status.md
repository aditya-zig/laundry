# Backend handoff

## Current verification — 21 October 2026

The notes below are the original integration handoff, not the current defect
list. At baseline `efef160`, configured WhatsApp media retrieval, structured
speech output, sender-isolated drafts and the durable notification transport
were already implemented and fixture-tested. The pilot and restart journey
were independently reverified; see [handoff QA](qa-handoff-2026-10-21.md).

Follow-up `fix/backend-handoff-20261021` repairs the remaining provider URL,
redirect, stream-size/body-timeout, acknowledgement and malformed-signature
failures. See [backend reliability verification](backend-reliability-2026-10-21.md)
and [customer pilot integration](customer-pilot-integration.md). Neither the
WhatsApp provider nor the native customer app is production-verified. The
garment conversation flow remains separate from the kilogram pilot.

## Original integration notes

Backend implementation includes PostgreSQL schema/shared auth/idempotency, catalog, quote/order/payment/fulfillment/logistics/review/support/conversation modules, Nest HTTP controllers, worker and HTTP acceptance suite. This is an integration handoff, not a passing claim.

The worker was interrupted after a stalled model request. All backend ownership is now released to final independent Muse verifier. The latest completed HTTP acceptance run reported 12 tests passed (2.79s), after earlier failures were repaired. Worker import paths then changed. Fresh combined builds/typechecks/acceptance and coordinator inspection leads still require verification and repairs. No local DB/API resource is production.

An API process launched during worker tests may still be running (pnpm parent PID173285 and tsx runtime PID173315); stop only these owned processes before clean tests. Main will supervise final dev group after start-request marker. Never kill unrelated apps.

Read integration-findings.md for coordinator inspection leads (CORS, static path, speech JSON/MIME, conversation isolation, deadlines, native media and environment values). Root dependency installation is available; final verifier owns root/lock now.

## Core feature gaps to finish in final integration pass

Source inspection shows WhatsApp audio webhook currently calls transcription with an empty Buffer and returns an unavailable note, and text replies are only returned in webhook HTTP responses. That is not a finished WhatsApp ordering implementation even after credentials are provided. Implement credential-configured media retrieval through Meta's official media API with safe host/byte/type bounds, real speech parsing, per-sender draft isolation and outbound replies/confirmation/payment links through the durable outbox and WhatsApp transport. No live sends during verification; test configured transport/media seams with local deterministic provider fixtures, signed inbound events and replay guards. Clearly mark account onboarding/sending as unverified without credentials.

Worker currently marks notification events dispatched without invoking a transport. Implement honest demo notification ledger/simulator and a configured WhatsApp transport route, with retries and actual transaction/lease semantics rather than SELECT FOR UPDATE outside a transaction. Ensure one owner claims an outbox row and duplicate deliveries never create extra orders/legs. Core voice/text conversation is part of user task, not optional scope. Existing startup production safeguards may reject non-demo until approved provider configuration, but completed code must not contain a success-looking empty audio stub.

User sends date/time/count/service/timeline in one voice message: actual speech response must preserve uncertainty, timeline must be parsed/confirmed and check capacity. Do not silently replace their requested deadline with a default. Support wash-and-iron intent as combined service and ask for ambiguous fields. If identity is not linked, use an explicit customer link/confirmation step and private channel-scoped draft; never share global demo draft across WhatsApp senders.

UI verifier has generated native-safe PNG derivatives under assets/services. Update demo catalog image URLs to existing .png versions if needed (backend-owned mapping) and verify HTTP image response; preserve SVG originals/manifest. Both Expo web exports have passed through independent Muse.
