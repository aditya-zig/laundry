# Published GitHub implementation queue

[Coordinating epic #5](https://github.com/aditya-zig/laundry/issues/5) · 23 child tasks · no PRs.

Only P00 and R01 were initially ready. Labels express dispatch eligibility, not launched workers. Read CLOUD-AGENTS.md for pinned prerequisites, leases and evidence gates.

Integration baseline: `cloud/P00-source-consolidation` at `f0efdc0`.

| Task | Issue | Role | Start blockers | Initial state |
|---|---|---|---|---|
| P00 | [#6 — Consolidate source branches and publish a safe cloud integration baseline](https://github.com/aditya-zig/laundry/issues/6) | coordinator | None | INTEGRATED |
| R01 | [#7 — Investigate LaundryMate with REA and publish an evidence-backed feature matrix](https://github.com/aditya-zig/laundry/issues/7) | research | None | READY |
| P01 | [#8 — Prove a reproducible cloud PostgreSQL/browser/evidence environment](https://github.com/aditya-zig/laundry/issues/8) | coordinator | P00 | BLOCKED_DEPENDENCY |
| C01 | [#9 — Freeze v2 wire contracts, SDK, module ports and migration integration rules](https://github.com/aditya-zig/laundry/issues/9) | coordinator | P00 | BLOCKED_DEPENDENCY |
| D01 | [#10 — Create the taste-led design system and reference screens for all three apps](https://github.com/aditya-zig/laundry/issues/10) | design | P00 | BLOCKED_DEPENDENCY |
| B01 | [#11 — Implement production identity, sessions, scoped staff access and owned addresses](https://github.com/aditya-zig/laundry/issues/11) | backend | P01, C01 | BLOCKED_DEPENDENCY |
| B02 | [#12 — Implement all four services, approved rate cards and unified KG/PIECE pricing](https://github.com/aditya-zig/laundry/issues/12) | backend | P01, C01 | BLOCKED_DEPENDENCY |
| B03 | [#13 — Implement service areas, scheduling calendars and atomic capacity reservations](https://github.com/aditya-zig/laundry/issues/13) | backend | P01, C01 | BLOCKED_DEPENDENCY |
| B04 | [#14 — Implement unified booking, intake, adjustments, care and cancellation](https://github.com/aditya-zig/laundry/issues/14) | backend | P01, C01 | BLOCKED_DEPENDENCY |
| B05 | [#15 — Implement due-at-return billing, manual receipts, gateway reconciliation and refunds](https://github.com/aditya-zig/laundry/issues/15) | backend | P01, C01 | BLOCKED_DEPENDENCY |
| B06 | [#16 — Implement assignments, pickup/return custody, handover proof and tracking](https://github.com/aditya-zig/laundry/issues/16) | backend | P01, C01 | BLOCKED_DEPENDENCY |
| B07 | [#17 — Implement private evidence uploads, media access and retention boundaries](https://github.com/aditya-zig/laundry/issues/17) | backend | P01, C01 | BLOCKED_DEPENDENCY |
| B08 | [#18 — Implement incidents, rewash resolution and verified consented reviews](https://github.com/aditya-zig/laundry/issues/18) | backend | P01, C01 | BLOCKED_DEPENDENCY |
| B09 | [#19 — Implement WhatsApp text/voice drafts, exact confirmation and human escalation](https://github.com/aditya-zig/laundry/issues/19) | backend | P01, C01 | BLOCKED_DEPENDENCY |
| B10 | [#20 — Implement durable worker retries, dead letters, privacy jobs and observability](https://github.com/aditya-zig/laundry/issues/20) | backend | P01, C01 | BLOCKED_DEPENDENCY |
| F00 | [#21 — Build shared app foundations, sessions, navigation and frozen route ownership](https://github.com/aditya-zig/laundry/issues/21) | frontend-foundation | P01, C01, D01 | BLOCKED_DEPENDENCY |
| F01 | [#22 — Redesign customer browse, service selection, bag and booking end to end](https://github.com/aditya-zig/laundry/issues/22) | frontend-customer-booking | F00 | BLOCKED_DEPENDENCY |
| F02 | [#23 — Redesign customer order tracking, account, help and verified reviews](https://github.com/aditya-zig/laundry/issues/23) | frontend-customer-orders | F00 | BLOCKED_DEPENDENCY |
| F03 | [#24 — Redesign delivery app with real assignments, custody and offline recovery](https://github.com/aditya-zig/laundry/issues/24) | frontend-rider | F00 | BLOCKED_DEPENDENCY |
| F04 | [#25 — Redesign operations console for full fulfillment and audited configuration](https://github.com/aditya-zig/laundry/issues/25) | frontend-ops | F00 | BLOCKED_DEPENDENCY |
| E01 | [#26 — Verify the integrated product in PostgreSQL and browsers with readable recordings](https://github.com/aditya-zig/laundry/issues/26) | verification | B01, B02, B03, B04, B05, B06, B07, B08, B09, B10, F01, F02, F03, F04 | BLOCKED_DEPENDENCY |
| E02 | [#27 — Build and verify customer and rider Android apps on a cloud runner](https://github.com/aditya-zig/laundry/issues/27) | native-verification | F01, F02, F03 | BLOCKED_DEPENDENCY |
| E03 | [#28 — Complete production readiness, migration/restore rehearsal and launch handoff](https://github.com/aditya-zig/laundry/issues/28) | coordinator-release | E01, E02 | BLOCKED_DEPENDENCY |
