# Production Laundry application — cloud-only parallel implementation

Build all four services across customer Android, delivery Android and operations web, with production backend workflows and activation gates.

[Read the complete implementation document](https://github.com/aditya-zig/laundry/blob/docs/production-cloud-plan-20261021/docs/implementation/production-application/IMPLEMENTATION.md). [Cloud execution/ownership protocol](https://github.com/aditya-zig/laundry/blob/docs/production-cloud-plan-20261021/docs/implementation/production-application/CLOUD-AGENTS.md). [Contract freeze specification](https://github.com/aditya-zig/laundry/blob/docs/production-cloud-plan-20261021/docs/implementation/production-application/CONTRACTS-V2.md).

Delivery is cloud task branches plus pushed SHAs, without PRs. One coordinator owns integration, contracts, migrations and root infrastructure. Only P00 and R01 are initially ready. Every other task waits for pinned prerequisites. This issue set does not launch cloud workers or authorize paid calls/production promotion.

## Task queue

- [ ] P00: Consolidate source branches and publish a safe cloud integration baseline
- [ ] R01: Investigate LaundryMate with REA and publish an evidence-backed feature matrix
- [ ] P01: Prove a reproducible cloud PostgreSQL/browser/evidence environment
- [ ] C01: Freeze v2 wire contracts, SDK, module ports and migration integration rules
- [ ] D01: Create the taste-led design system and reference screens for all three apps
- [ ] B01: Implement production identity, sessions, scoped staff access and owned addresses
- [ ] B02: Implement all four services, approved rate cards and unified KG/PIECE pricing
- [ ] B03: Implement service areas, scheduling calendars and atomic capacity reservations
- [ ] B04: Implement unified booking, intake, adjustments, care and cancellation
- [ ] B05: Implement due-at-return billing, manual receipts, gateway reconciliation and refunds
- [ ] B06: Implement assignments, pickup/return custody, handover proof and tracking
- [ ] B07: Implement private evidence uploads, media access and retention boundaries
- [ ] B08: Implement incidents, rewash resolution and verified consented reviews
- [ ] B09: Implement WhatsApp text/voice drafts, exact confirmation and human escalation
- [ ] B10: Implement durable worker retries, dead letters, privacy jobs and observability
- [ ] F00: Build shared app foundations, sessions, navigation and frozen route ownership
- [ ] F01: Redesign customer browse, service selection, bag and booking end to end
- [ ] F02: Redesign customer order tracking, account, help and verified reviews
- [ ] F03: Redesign delivery app with real assignments, custody and offline recovery
- [ ] F04: Redesign operations console for full fulfillment and audited configuration
- [ ] E01: Verify the integrated product in PostgreSQL and browsers with readable recordings
- [ ] E02: Build and verify customer and rider Android apps on a cloud runner
- [ ] E03: Complete production readiness, migration/restore rehearsal and launch handoff

## Milestone acceptance

- [ ] All four approved/configured services complete real SDK/API/PostgreSQL/browser scenarios across all three apps.
- [ ] Replay/ownership/version/capacity/custody/payment/consent and restart tests pass on the integrated SHA.
- [ ] Cloud Android builds and native evidence pass; browser proof is not native proof.
- [ ] Readable 1080p/30fps recordings and raw traces are accessible and metadata checked.
- [ ] Business/provider activation, restore/security/operations and actual fulfillment-pilot gates have evidence; unresolved gates stay blocked.

Use child issue dependencies and TASKS.json to dispatch parallel workers, not checkbox order.
