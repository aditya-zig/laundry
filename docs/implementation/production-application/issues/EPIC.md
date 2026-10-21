# Production Laundry application — cloud-only parallel implementation

Build all four services across customer Android, delivery Android and operations web, with production backend workflows and activation gates.

[Read the complete implementation document](https://github.com/aditya-zig/laundry/blob/docs/production-cloud-plan-20261021/docs/implementation/production-application/IMPLEMENTATION.md). [Cloud execution/ownership protocol](https://github.com/aditya-zig/laundry/blob/docs/production-cloud-plan-20261021/docs/implementation/production-application/CLOUD-AGENTS.md). [Contract freeze specification](https://github.com/aditya-zig/laundry/blob/docs/production-cloud-plan-20261021/docs/implementation/production-application/CONTRACTS-V2.md).

Delivery is cloud task branches plus pushed SHAs, without PRs. One coordinator owns integration, contracts, migrations and root infrastructure. Only P00 and R01 are initially ready. Every other task waits for pinned prerequisites. This issue set does not launch cloud workers or authorize paid calls/production promotion.

## Task queue

- [ ] #6 · P00: Consolidate source branches and publish a safe cloud integration baseline
- [ ] #7 · R01: Investigate LaundryMate with REA and publish an evidence-backed feature matrix
- [ ] #8 · P01: Prove a reproducible cloud PostgreSQL/browser/evidence environment
- [ ] #9 · C01: Freeze v2 wire contracts, SDK, module ports and migration integration rules
- [ ] #10 · D01: Create the taste-led design system and reference screens for all three apps
- [ ] #11 · B01: Implement production identity, sessions, scoped staff access and owned addresses
- [ ] #12 · B02: Implement all four services, approved rate cards and unified KG/PIECE pricing
- [ ] #13 · B03: Implement service areas, scheduling calendars and atomic capacity reservations
- [ ] #14 · B04: Implement unified booking, intake, adjustments, care and cancellation
- [ ] #15 · B05: Implement due-at-return billing, manual receipts, gateway reconciliation and refunds
- [ ] #16 · B06: Implement assignments, pickup/return custody, handover proof and tracking
- [ ] #17 · B07: Implement private evidence uploads, media access and retention boundaries
- [ ] #18 · B08: Implement incidents, rewash resolution and verified consented reviews
- [ ] #19 · B09: Implement WhatsApp text/voice drafts, exact confirmation and human escalation
- [ ] #20 · B10: Implement durable worker retries, dead letters, privacy jobs and observability
- [ ] #21 · F00: Build shared app foundations, sessions, navigation and frozen route ownership
- [ ] #22 · F01: Redesign customer browse, service selection, bag and booking end to end
- [ ] #23 · F02: Redesign customer order tracking, account, help and verified reviews
- [ ] #24 · F03: Redesign delivery app with real assignments, custody and offline recovery
- [ ] #25 · F04: Redesign operations console for full fulfillment and audited configuration
- [ ] #26 · E01: Verify the integrated product in PostgreSQL and browsers with readable recordings
- [ ] #27 · E02: Build and verify customer and rider Android apps on a cloud runner
- [ ] #28 · E03: Complete production readiness, migration/restore rehearsal and launch handoff

## Milestone acceptance

- [ ] All four approved/configured services complete real SDK/API/PostgreSQL/browser scenarios across all three apps.
- [ ] Replay/ownership/version/capacity/custody/payment/consent and restart tests pass on the integrated SHA.
- [ ] Cloud Android builds and native evidence pass; browser proof is not native proof.
- [ ] Readable 1080p/30fps recordings and raw traces are accessible and metadata checked.
- [ ] Business/provider activation, restore/security/operations and actual fulfillment-pilot gates have evidence; unresolved gates stay blocked.

Use child issue dependencies and TASKS.json to dispatch parallel workers, not checkbox order.
