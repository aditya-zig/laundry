# Legacy public integration boundary

Baseline: `7c85eef5bd518b5f325c0746b0bc629e2901a800`.

A new real-HTTP safety regression reproduced `GET /v1/services` returning 200
outside demo mode. The same public controller could advertise the synthetic
`demo-area-bengaluru` service area. Configuring the independent v2 identity
boundary must not turn those historical synthetic values or provider callbacks
into production integrations.

The legacy catalog, billing and conversation controllers now require explicit
nonproduction demo mode, including their public serviceability and provider
webhook routes. Outside that mode they return a non-cacheable 503 with an honest
provider-unavailable envelope. Existing v1 demo journeys remain available only
when explicitly selected. Real integrations must be implemented through their
versioned v2 modules and separately accepted; no fallback silently activates them.

The actual compiled container check also asserts these public legacy paths stay
closed without demo credentials. The first full regression run caught a fixture
boundary assumption: a test intentionally set demo off to exercise direct
WhatsApp transport calls against a local provider, then reused that setting for
legacy HTTP/business handling. The test still proves the real-mode transport
with its loopback responses, then explicitly selects demo for the legacy HTTP
path. That path still retrieves the real loopback media and asserts duplicate
messages produce exactly one message/outbox effect. No general bypass or fake
production flag was introduced. Production mode cannot select demo.

Direct review checked the shared guard, non-cacheable error, retained raw
signature/duplicate tests and no staff/customer-token promotion. Local check,
full build, 688 workspace tests, 77 tooling tests and four actual compiled-API
web scenarios pass. The initial observed failures are retained privately, not
relabeled green. Fresh committed container/cloud verification follows separately.

Preceding `7c85eef` clean local evidence already passed actual container/context,
compiled privacy worker, legacy-worker production refusal, all 44 restored tables
including encrypted identity replay, and the full pilot/browser/API-restart
journey. Those receipts do not approve this later diff or whole-product launch.
The remaining node-forge tooling advisory, staff/MFA and v2 business/app/provider/
native/operational gates remain explicit blockers.
