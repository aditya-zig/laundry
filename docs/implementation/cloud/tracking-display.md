# Tracking display regressions from recording review

Full-frame review exposed two misleading facts on the actual delivered-order
screen: `Pending: RETURNING` remained after authoritative delivery, and a cancel
action remained visible after delivery. A sparse state history was incorrectly
being treated as a complete list of customer journey milestones.

The fulfillment browser regression first failed with the actual pending-return
row present (expected count zero, received one). Customer progress now derives
normal ordered milestones from the authoritative order state, marks the current
non-terminal stage as **Current**, and completes the journey at delivery. It does
not fabricate history rows or timestamps. Exception/cancelled/unknown states use
only **Recorded** / **Not reached** rather than inferring future milestones or
promises. Cancellation is offered only in explicitly supported early states;
server authorization, expected-version checks and refund decisions remain
unchanged and authoritative.

Ten pure display tests cover sparse delivered history, pickup in progress,
undelivered return, six exception/unknown states and conservative cancellation.
The browser additionally checks that a delivered order has no pending-return row
or cancel action. Local customer build/check, all four actual browser scenarios,
622 workspace tests (external providers remain demo adapters), and the prior 68
tooling cases pass. Clean-revision receipts must be obtained after committing.

This is a legacy customer correctness repair, not the production-v2 redesign or
identity, live payment, native or physical fulfillment acceptance.
