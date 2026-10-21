# Agent execution index

Read [product spec](../specs/product-spec.md), [contracts](../specs/contracts.md) and [main plan](../superpowers/plans/2026-10-11-laundry.md) before a packet. A0 freezes executable contracts first; A1–A8 then run concurrently in separate worktrees. A9 authors tests concurrently and executes after integration. All names/paths are proposed new files.

- [A0: Foundation and coordinator](a0-foundation-and-coordinator.md) — depends on None.
- [A1: Catalog and reviews](a1-catalog-and-reviews.md) — depends on A0 contracts-v1.
- [A2: Orders and fulfillment](a2-orders-and-fulfillment.md) — depends on A0 contracts-v1.
- [A3: Billing and reconciliation](a3-billing-and-reconciliation.md) — depends on A0 contracts-v1.
- [A4: Logistics and custody](a4-logistics-and-custody.md) — depends on A0 contracts-v1.
- [A5: Customer mobile app](a5-customer-mobile-app.md) — depends on A0 contracts-v1.
- [A6: Partner mobile app](a6-partner-mobile-app.md) — depends on A0 contracts-v1.
- [A7: Operations console](a7-operations-console.md) — depends on A0 contracts-v1.
- [A8: WhatsApp voice and text](a8-whatsapp-voice-and-text.md) — depends on A0 contracts-v1.
- [A9: Cross-system acceptance](a9-cross-system-acceptance.md) — depends on A0 for test authoring; A1–A8 merged for complete execution.

## Copyable dispatch instruction

Implement packet `<ID>` only. Read the linked product spec and contracts, start from the coordinator’s `contracts-v1` baseline, and obey the write allowlist. Do not change shared schemas or dependencies. Request changes from A0 with affected consumers and tests. Return an owned-path commit plus verification evidence; do not merge or deploy.
