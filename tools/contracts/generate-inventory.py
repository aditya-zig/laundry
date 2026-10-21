#!/usr/bin/env python3
"""Generate the C01 contract inventory from the current route registry.

The inventory records declared schema names, ownership and request rules.
It does not prove executable schema coverage or backend implementation.
"""
import json
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = f"{REPO}/packages/contracts/dist/index.js"

script = """
import { v2 } from '%s';
const reg = v2.ROUTE_REGISTRY;
const out = {
  routes: reg.map(r => ({
    id: r.id, method: r.method, path: r.path, summary: r.summary,
    request: r.requestSchema ?? null, response: r.responseSchema,
    roles: r.roles, idempotency: r.idempotency, errors: r.errorCodes,
    owner: r.ownerTask, status: r.status
  })),
  events: v2.eventTypeSchema.options,
  errorCodes: v2.errorCodeSchema.options,
  services: v2.serviceCodeSchema.options,
  billingUnits: v2.billingUnitSchema.options,
};
process.stdout.write(JSON.stringify(out));
""" % DIST

res = subprocess.run(
    ["node", "--input-type=module", "-e", script], capture_output=True, text=True, cwd=REPO
)
if res.returncode != 0:
    print(res.stderr, file=sys.stderr)
    sys.exit(1)
data = json.loads(res.stdout)

lines = []
lines.append("# C01 contract inventory")
lines.append("")
lines.append("Contract target: `laundry-wire-v2.0.0`.")
lines.append("")
lines.append("C01 is not frozen. This file records declarations generated from `packages/contracts/src/v2/routes.ts`. A schema name does not prove that the schema exists or that a backend implements it. Permission and transaction behavior below are requirements, not acceptance evidence. See `IDENTITY-AND-ROUTING.md` for the latest SDK checks and remaining gaps.")
lines.append("")
lines.append(f"Published operations: {len(data['routes'])}.")
lines.append(f"Event types: {len(data['events'])}.")
lines.append(f"Error codes: {len(data['errorCodes'])}.")
lines.append(f"Service codes: {len(data['services'])}.")
lines.append(f"Billing units: {len(data['billingUnits'])}.")
lines.append("")
lines.append("## Permission and idempotency rules")
lines.append("")
lines.append("| Rule | Meaning |")
lines.append("|---|---|")
lines.append("| `PUBLIC` | No session. The route may return only public catalog and reference data. |")
lines.append("| `CUSTOMER` | The session must resolve to a customer, and the route must scope the read or write to that customer's own records. |")
lines.append("| `RIDER` | The session must resolve to a delivery partner, and the route must scope the read or write to that partner's current assignment. |")
lines.append("| `OPERATOR` | The session must resolve to a staff member with facility membership. The facility scope comes from the server, never from the request body. |")
lines.append("| `SUPPORT` | Staff support access, audited. |")
lines.append("| `ADMIN` | Administrative access, audited, and never granted by a client-selected field. |")
lines.append("| `REQUIRED` | The request carries an `Idempotency-Key`. The same key with the same payload replays the original result. The same key with a different payload is an idempotency conflict. |")
lines.append("| `OPTIONAL` | The command accepts an idempotency key. Without one the command is not safe to retry. |")
lines.append("| `NOT_APPLICABLE` | A read. A read never sends an idempotency key. |")
lines.append("")
lines.append("## Operations")
lines.append("")

for owner in sorted({r["owner"] for r in data["routes"]}):
    lines.append(f"### {owner}")
    lines.append("")
    lines.append("| Method | Path | Request | Response | Roles | Idempotency | Errors |")
    lines.append("|---|---|---|---|---|---|---|")
    for r in data["routes"]:
        if r["owner"] != owner:
            continue
        lines.append(
            f"| `{r['method']}` | `{r['path']}` | {('`' + r['request'] + '`') if r['request'] else '-'} "
            f"| `{r['response']}` | {', '.join(r['roles'])} | {r['idempotency']} | {', '.join(r['errors'])} |"
        )
    lines.append("")

lines.append("## Events")
lines.append("")
lines.append("Every event uses the envelope `{eventId, eventType, schemaVersion: 2, aggregateId, aggregateVersion, occurredAt, traceId, payload}`.")
lines.append("")
lines.append("| Event type | Emitted when | Consumers |")
lines.append("|---|---|---|")
EVENTS = [
    ("order.confirmed.v2", "A booking creates an order and its due-at-return obligation", "B04, B05, B06, F01, F02"),
    ("order.intake-recorded.v2", "The facility records counted and measured intake", "B04, B05, F02, F04"),
    ("order.adjustment-decided.v2", "The customer accepts or declines a price adjustment", "B04, B05, F02"),
    ("order.ready-for-return.v2", "Care and quality check are complete", "B06, F02, F03"),
    ("order.delivered.v2", "Return custody is accepted and the order is delivered", "B05, B08, F02"),
    ("payment.settled.v2", "An obligation reaches settled or void", "B05, B04, F02, F04"),
    ("refund.updated.v2", "A refund moves state", "B05, F02, F04"),
    ("delivery.updated.v2", "A delivery leg attempt moves state", "B06, F02, F03, F04"),
    ("media.uploaded.v2", "A private media object becomes available", "B07, B08, F02, F03"),
    ("conversation.draft-confirmed.v2", "A conversation draft is confirmed against the current quote", "B09, B04, F02"),
]
for et, when, consumers in EVENTS:
    lines.append(f"| `{et}` | {when} | {consumers} |")
lines.append("")

lines.append("## Internal ports")
lines.append("")
lines.append("Every module writes through a typed port. A port never accepts a client-supplied role or scope, and a port never throws across a module boundary. Each command carries `CommandMeta` with the server-derived actor, the idempotency key, the expected version when the aggregate is versioned, a trace id and the request time.")
lines.append("")
lines.append("| Port | Owning module | Commands |")
lines.append("|---|---|---|")
PORTS = [
    ("IdentityPort", "B01", "requestOtp, verifyOtp, refreshSession, revokeSession, inviteStaff, completeMfa, listAddresses, createAddress, linkWhatsapp"),
    ("PricingPort", "B02", "priceBasket, effectiveRate, approveRateCard, activateRateCard"),
    ("AvailabilityPort", "B03", "listSlots, hold, reserve, release, setCapacity"),
    ("OrdersPort", "B04", "quote, book, recordIntake, decideAdjustment, cancel, reschedule"),
    ("BillingPort", "B05", "createObligation, recordAttempt, confirmManualPayment, refund, reconcile"),
    ("LogisticsPort", "B06", "assign, reassign, recordHandover, reportException"),
    ("MediaPort", "B07", "createUploadIntent, finalize, resolveDownload, deleteExpired"),
    ("SupportPort", "B08", "openIncident, postIncidentMessage, resolveIncident, requestRewash"),
    ("ReviewsPort", "B08", "listEligible, createReview, moderateReview"),
    ("ConversationsPort", "B09", "receiveInbound, reviseDraft, confirmDraft, requestHandoff"),
    ("SpeechPort", "B09", "transcribe"),
    ("NotificationTransport", "B10", "send, sendBatch"),
    ("JobsPort", "B10", "enqueue, claim, complete, fail, deadLetter, replay"),
]
for port, module, commands in PORTS:
    lines.append(f"| `{port}` | {module} | {commands} |")
lines.append("")

lines.append("## Transaction participation")
lines.append("")
lines.append("| Command | Joins the caller's transaction | Runs after commit |")
lines.append("|---|---|---|")
TX = [
    ("book", "Quote validation, ownership, version check, capacity reservation, order creation, obligation creation, audit, idempotency result and outbox record", "Notification and provider calls"),
    ("recordIntake", "Measured facts, container events, adjustment creation, audit, outbox record", "Notification and provider calls"),
    ("decideAdjustment", "Adjustment state, order state, audit, outbox record", "Notification and provider calls"),
    ("confirmManualPayment", "Receipt, obligation balance, ledger entry, audit, outbox record", "Notification and provider calls"),
    ("recordHandover", "Custody event, leg attempt state, order state, audit, outbox record", "Notification and provider calls"),
    ("refund", "Refund state, ledger entry, audit, outbox record", "Gateway calls"),
    ("reserve", "Capacity hold and reservation, audit, outbox record", "Notification and provider calls"),
]
for cmd, inside, after in TX:
    lines.append(f"| `{cmd}` | {inside} | {after} |")
lines.append("")
lines.append("No vendor network request happens inside a long database transaction. The intent and a stable provider reference are persisted first, the external call runs after the commit, and the outcome is reconciled afterwards, including the case where the outcome is unknown.")
lines.append("")

lines.append("## Compatibility")
lines.append("")
lines.append("The v1 contract is unchanged and keeps its own exports, its own default base URL and its own tests. The v2 contract is exported as a namespace, `import { v2 } from \"@laundry/contracts\"`, so a consumer can migrate one screen at a time. A v1 order keeps its recorded model and payment facts. A legacy record is never relabelled as a native v2 order by changing an identifier.")
lines.append("")

dest = sys.argv[1] if len(sys.argv) > 1 else f"{REPO}/docs/implementation/contracts/INVENTORY.md"
import os
os.makedirs(os.path.dirname(dest), exist_ok=True)
open(dest, "w", encoding="utf-8").write("\n".join(lines).rstrip() + "\n")
print(f"wrote {dest} with {len(data['routes'])} operations")
