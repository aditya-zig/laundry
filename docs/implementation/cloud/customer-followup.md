# Customer UI follow-up — isolated candidate work

Integration checkpoint: `5a572d8f1932ece83e38a9e29dd316fcc2cf8e11`.

The previous F01 process failed its bound and returned booking helpers, not a mounted customer journey. Those helpers now compile and run in the normal customer suite, but the real Expo tab routes still use legacy clients. This is an implementation gap, not accepted customer production functionality.

F01 exclusively owns `apps/customer/app/**`, `apps/customer/src/features/booking/**`, and its existing handoff directory for this follow-up. The coordinator will not edit those paths while its cloud lease is active. The widened ownership fixes a dispatch error: the previous allowlist omitted the actual `app/(tabs)` entry and root layout. No worker owns contracts, SDK, session foundation, root manifests/lock, CI, backend, infrastructure, or publication.

Required bounded deliverable: actual mounted phone sign-in, server catalog, typed kg/piece bag, owned address and server-returned slot selection, current quote, explicit booking confirmation with retained intent, and the authoritative order result. Reuse existing helpers rather than rewriting them. No invented launch rates, areas, capacity or provider readiness; missing configuration/data must be explicit. Legacy demo behavior cannot masquerade as production. Memory-only browser/native storage is not durable/device acceptance.

The workflow now permits dispatching a single fixed, allowlisted lane rather than rerunning peers. Runtime remains pinned to OpenCode 1.19.4 and an explicitly verified zero-cost model, no paid fallback or provider calls. It runs in an isolated read-only-credential GitHub checkout, returns an ownership-checked patch, and cannot push/deploy. Failed/partial runs remain failed even if useful source can be reviewed. Coordinator review, tests, actual browser inspection and all release gates remain mandatory.

This follow-up does not resolve the node-forge advisory, commercial/provider acceptance, secure native storage, physical fulfillment or deployment prerequisites. The existing platform endpoint is still a disabled-product infrastructure probe, not a deployed product API.
