# Backend reliability follow-up — 21 October 2026

Branch `fix/backend-handoff-20261021`, based on `efef160` (`feat/backend-mvp`,
PR #3). User authorized backend fixes and preparation for the customer UI's
connection to the kilogram pilot. Customer, partner and operations UI files,
wire contracts, root manifests and dependency versions were not changed.

## Reproduced defects and repairs

| Reproduction at the provider boundary | Before | Repair and evidence |
| --- | --- | --- |
| Metadata names an unrelated HTTPS host, lookalike host, metadata-service IP or alternate port | URL was accepted and requested with the bearer token | Exact Graph / media-host validation before authenticated fetch; negative cases reject without a second request |
| An API override contains `localhost` inside an unrelated hostname | Substring enabled loopback media exception | Parse and validate the API origin; local fixtures are non-production only, and media must stay on that exact origin and port |
| A valid-looking media URL returns a redirect to a different local service | Fetch followed the redirect | Redirects fail closed; the local target receives zero requests |
| Chunked media exceeds 10 MB without Content-Length | Whole body was consumed before rejection | Streaming byte counter cancels the reader before the fixture ends its response |
| Server sends headers/audio prefix, then stalls | Timeout was cleared after headers; body stayed pending | Deadline spans headers and body; real socket abort observed at 20 seconds |
| Successful HTTP acknowledgement has no message ID | Returned `sent` with no provider ID | Reject incomplete acknowledgements; worker retry/error path remains authoritative |
| Optional API base/version settings are blank, as in `.env.example` | Invalid URL or missing version instead of defaults | Empty optional values use the trusted Graph origin and pinned version; regression exercised before/after |
| A signature has 64 non-ASCII characters | Constant-time comparison threw because byte lengths differed | Validate a 64-hex-digit digest and compare decoded bytes; malformed signatures return false |

JSON provider responses are also read with a 64 KB bound and the same active
body deadline. Errors/unsupported MIME reject before retaining the media body.
No downloaded audio is written to disk by this transport.

Red evidence: `/tmp/laundry-media-red.log` (9 failed / 1 passed) and
`/tmp/laundry-signature-red.log` (1 failed / 4 passed). The first media recheck
confirmed the redirect was blocked but exposed an over-specific error-message
assertion; the test now asserts rejection plus zero target requests instead of
depending on Node's wording. A fixture listener-cleanup warning was also repaired.
These changes did not weaken the behavioral expectations.

Native regressions:

- `apps/api/test/whatsapp-media.regression-1.test.ts`: 14 cases, including real
  loopback HTTP streams/redirects/stalls and mocked external-host responses.
- `apps/api/test/whatsapp-signature.regression-1.test.ts`: 5 cases using actual
  HMAC computation and exact raw bytes.

Value: protects authenticated media destination, bounded resource use, honest
send acknowledgement and non-throwing signature rejection; fails when the URL,
redirect, streaming/deadline, ID or hex guards are removed; no test-only
production seam was added. Provider fixtures replace external HTTP only.
Green does not prove live Meta compatibility or message delivery.

## Customer integration preparation

[Customer pilot integration](customer-pilot-integration.md) maps screens to
existing SDK methods, grams/minor-INR units, full timezone-qualified windows,
retained idempotency keys, versioned price consent and separate order/payment/
delivery states. It identifies legacy calls that the customer UI must replace.

`apps/api/test/pilot-customer-client.test.ts` exercises the real shared SDK,
Nest API and PostgreSQL. It verifies booking/config parsing, one reservation
after replay, conflicting-key refusal, code privacy, price-consent gate,
stale-version rejection, replayed approval and no legacy prepayment. It ends
at `IN_CARE`; return/payment/delivery claims belong to the existing
`pilot.test.ts`, `pilot-guard.test.ts` and recorded browser journey.

The root-level test initially hit a Nest dependency-resolution error before
collection. Moving the consumer test into the API workspace's existing test
suite resolved setup without changing dependencies or runner configuration.

Trial composition of pilot `efef160` and UI `4684f72` was conflict-free.
The exported combined tree passed offline frozen-lock validation. This is
preparation, not an actual merge or a connected customer UI.

## Verification and limits

Full workspace `pnpm test`: 119 tests passed, including 63 API tests.
`pnpm check` and `pnpm build`: passed. Logs and exit-code files are in ignored
`.verification/backend-handoff/`. Convex check, 23 voice tests and 7 tooling tests also passed.

Recorded browser run `20261021102045` passed at tested revision `9737cd2`,
including API restart persistence. Paid order
`d0dbdfe1-2997-4c26-9b2a-d9c5cc598a1c` finished DELIVERED/PAID/36000 minor INR;
held order `63fd80d8-e766-4e3d-a8cc-a3d8a25d629c` finished
DELIVERED/UNPAID/0 after an agreed unprocessed return. Tracking was closed;
no unexpected JavaScript console errors were reported. The manifest, video,
trace and screenshots are in ignored `.verification/pilot/`. Previous evidence
was preserved under `.verification/backend-handoff/previous-pilot/`.
The shared T3 browser also opened the current backend console on port 5176.

Latest UI composition check used `69f56cf` and backend `9737cd2`, produced
a conflict-free trial tree, and passed offline frozen-lock validation. No
branch was merged; this documentation follow-up changes no application code.

Two local reviews examined Standards/security and Spec/consumer coverage.
No blocking findings remained; the reviewer independently ran the initial 18 transport
regressions successfully. The final blank-settings regression and full 119-test
suite were rerun after that review; workspace check and API/worker builds also passed. External Claude review was unavailable.

The Graph lookup/download request shape was cross-checked against Meta's
[Retrieve Media URL](https://www.postman.com/meta/whatsapp-business-platform/request/ptjyi84/retrieve-media-url)
and [Download Media](https://www.postman.com/meta/whatsapp-business-platform/request/zsq66eh/download-media)
collection. Accepting only `graph.facebook.com` and `lookaside.fbsbx.com` on
standard HTTPS, and refusing redirects, is an explicit conservative transport
policy. Fixtures prove those rules, not that every future legitimate provider
response uses those destinations. Validate provider sandbox behavior before
enabling real media; do not relax the rule to arbitrary hosts on a fetch error.

All credentials, messages and audio used here are synthetic. No commercial
provider, paid transcription/model, live message send, merge or production
deployment was performed. Session expiry/token hashing, OTP transport,
real-provider onboarding, approved rates and physical delivery remain separate
work. WhatsApp conversation drafting still uses the legacy garment contract.
