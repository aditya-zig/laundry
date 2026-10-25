# Customer intake consent integration

This extends the committed booking checkpoint `58de8ae28e02af32e807a3663be008facfea4853`. That clean commit passed the real browser/compiled-HTTP/disposable-PostgreSQL acceptance with `sourceDirty: false`; it is not a deployed release. The `58de8ae` GitHub workflows are still red: Laundry checks `40219821911` and Agent verification `40219821984` fail their four legacy demo-oriented browser scenarios; security `40219821869` fails the dependency gate. Those failures are not reclassified as passes by the separate customer booking acceptance.

## Scope

- Owned order detail renders the server's adjustment reason, previous/proposed totals, proposal state and expiry.
- Accept and decline are explicit customer clicks and only appear for the corresponding server-permitted actions. Decline is explained as a care hold, not automatic cancellation or approval of extra charges.
- The exact order version, adjustment ID/version and decision are validated and journaled before sending through the shared SDK.
- Lost/ambiguous replies retain the original intent/key. Leaving/reopening detail recovers that intent and presents only a check of the original decision, not a replacement consent. A changed order or expired proposal never silently upgrades the decision to fresh terms.
- Credential/identity changes still unmount the private screen and quarantine commands belonging to another scope. Default browser stores remain memory-only; reload/process-death durability and native storage are not claimed.

## Evidence

The first focused run reproduced two failures: the foundation could not dispatch/replay either adjustment decision. The fixed sender is an explicit, schema-validated SDK dispatch, not a generic saved URL executor.

Focused TypeScript checks passed, and **132 tests** passed: foundation 32 and customer 100 (including five consent/version/expiry/recovery cases). The first extended browser run reached the real unknown-decision UI without runtime errors, then failed on an incorrect test-only header selector (`Back` is not the native header's accessible button name). The corrected navigation check uses the browser's actual back history and passed with zero runtime errors: original decision key/body replayed, one order/obligation/pickup/confirmed event and exactly one adjustment-acceptance audit. The screenshot checkpoint additionally waits for the fresh owned-order read/history rather than capturing the intervening loading state. A clean-commit rerun records its source revision/dirty state separately before evidence publication. The browser fixture creates synthetic staff/intake through the domain service, injects a post-commit 503/unknown for the explicit accept, navigates out/back, checks the original key/body and requires one acceptance audit. Synthetic staff setup is not production staff MFA, physical weighing/custody or a commercial provider integration. Test helpers are gated to an explicitly opted-in, loopback-only disposable verification database and are not shipped in the production image.

## Still blocked

Product API/app deployment, the unresolved dependency advisory, approved launch rates/areas/capacity/care/refund terms, live providers/commercial permission, native secure stores/devices and physical fulfillment acceptance remain separate gates. This change does not enable ordering. Customer cancellation, rescheduling, payment detail, reviews and support conversation UI remain unfinished.
