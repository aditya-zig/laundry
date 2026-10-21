import type { Pool, PoolClient } from "pg";
import { randomInt } from "node:crypto";
import type { PilotAction } from "@wandary/contracts";
import type { Actor } from "../../shared/src/auth";
import { ApiError, type ErrorCode } from "../../shared/src/errors";
import { handoverExpiry, pilotTransaction, pilotView, requireAccess, requireOperator, RecordedPilotRejection, type PilotRow } from "./pilot";

function allowed(condition: boolean, message: string, code: ErrorCode = "INVALID_INPUT") {
  if (!condition) throw new ApiError(code, message, { status: 409 });
}
async function verifyCode(tx: PoolClient, row: PilotRow, leg: "PICKUP" | "RETURN", code: string) {
  const prior = (await tx.query(`SELECT attempts FROM pilot_handover_attempts WHERE order_id=$1 AND leg=$2`, [row.id, leg])).rows[0];
  allowed(Number(prior?.attempts ?? 0) < 5, "Too many handover attempts; the customer can issue a new code");
  const expiresAt = leg === "PICKUP" ? row.data.pickupCodeExpiresAt : row.data.returnCodeExpiresAt;
  if (expiresAt && Date.now() > Date.parse(expiresAt)) {
    throw new RecordedPilotRejection("HANDOVER_CODE_EXPIRED", "This handover code has expired; the customer can issue a new one", { status: 409 });
  }
  if (code !== (leg === "PICKUP" ? row.data.pickupCode : row.data.returnCode)) {
    await tx.query(`INSERT INTO pilot_handover_attempts (order_id,leg,attempts) VALUES ($1,$2,1) ON CONFLICT (order_id,leg) DO UPDATE SET attempts=pilot_handover_attempts.attempts+1`, [row.id, leg]);
    throw new RecordedPilotRejection("INVALID_INPUT", "Incorrect customer handover code", { status: 409 });
  }
}
function customerOnly(actor: Actor) {
  if (actor.role !== "customer") throw new ApiError("FORBIDDEN", "Customer approval is required", { status: 403 });
}
function riderOnly(actor: Actor, row: PilotRow) {
  if (actor.role !== "rider" || row.rider_id !== actor.id) throw new ApiError("FORBIDDEN", "Assigned rider required", { status: 403 });
}

export async function pilotAction(db: Pool, actor: Actor, id: string, input: PilotAction, key: string) {
  // The order row is loaded and access-checked before any stored response is
  // replayed, so losing the order (reassignment) revokes read and replay.
  let loaded: PilotRow | undefined;
  return pilotTransaction(
    db,
    actor,
    "pilot.action",
    key,
    { id, ...input },
    async (tx) => {
    // The guard already loaded and checked the row. It is loaded again here
    // so the work path checks access on its own and stays correct on its own.
    const row = loaded ?? (await tx.query<PilotRow>(`SELECT * FROM pilot_orders WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    requireAccess(row, actor);
    const data = { ...row.data };
    allowed(data.version === input.expectedVersion, "This order changed; refresh before retrying", "VERSION_CONFLICT");
    let label: string = input.action;
    switch (input.action) {
      case "ASSIGN": {
        requireOperator(actor);
        allowed(["BOOKED", "READY_FOR_RETURN", "RETURNING"].includes(data.status), "Assignment is not allowed at this stage");
        const rider = (await tx.query(`SELECT id FROM users WHERE id=$1 AND role='rider'`, [input.riderId])).rows[0];
        if (!rider) throw new ApiError("INVALID_INPUT", "Choose a registered rider", { status: 400 });
        row.rider_id = input.riderId;
        if (data.status === "BOOKED") data.pickupStatus = "ASSIGNED";
        else data.returnStatus = "ASSIGNED";
        label = "Rider assignment recorded";
        break;
      }
      case "PICKUP":
        riderOnly(actor, row);
        allowed(data.status === "BOOKED" && data.pickupStatus === "ASSIGNED", "Pickup requires an assigned, booked order");
        await verifyCode(tx, row, "PICKUP", input.code);
        data.pickupStatus = "COMPLETED"; data.status = "PICKED_UP";
        label = "Pickup handover confirmed by customer code";
        break;
      case "INTAKE": {
        if (actor.role === "rider") riderOnly(actor, row); else requireOperator(actor);
        allowed(data.status === "PICKED_UP", "Intake follows confirmed pickup");
        data.measuredWeightGrams = input.measuredWeightGrams;
        const measuredTotal = Math.ceil(input.measuredWeightGrams * data.rateMinorPerKg / 1000);
        if (input.measuredWeightGrams < data.estimatedWeightGrams) {
          data.status = "ON_HOLD"; data.holdReason = "Lower-weight/minimum-package billing needs a founder decision; processing held";
          label = "Lower measured weight: founder billing decision required";
        } else if (measuredTotal > data.totalMinor) {
          data.status = "AWAITING_APPROVAL"; data.proposedTotalMinor = measuredTotal;
          label = "Higher intake price awaits customer approval";
        } else {
          data.status = "INTAKE_COMPLETE"; label = "Intake matches the agreed estimate";
        }
        label += ` (${input.bagCount} bag${input.bagCount === 1 ? "" : "s"})`;
        break;
      }
      case "APPROVE_PRICE":
        customerOnly(actor);
        allowed(data.status === "AWAITING_APPROVAL" && data.proposedTotalMinor !== null, "No price increase awaits approval");
        data.totalMinor = data.proposedTotalMinor!; data.proposedTotalMinor = null; data.status = "INTAKE_COMPLETE";
        label = "Customer approved final price; payment remains due at return";
        break;
      case "DECLINE_PRICE":
        customerOnly(actor);
        allowed(data.status === "AWAITING_APPROVAL", "No price increase awaits a decision");
        data.status = "ON_HOLD"; data.holdReason = "Customer declined price increase; founder must agree an unprocessed return";
        label = "Price declined; processing held for founder resolution";
        break;
      case "START_CARE":
        requireOperator(actor);
        allowed(data.status === "INTAKE_COMPLETE", "Resolve intake and obtain price approval before processing", "REQUIRES_APPROVAL");
        data.status = "IN_CARE"; label = "Laundry processing started";
        break;
      case "QUALITY_CHECK":
        requireOperator(actor); allowed(data.status === "IN_CARE", "Quality check follows processing");
        data.status = "QUALITY_CHECK"; label = "Quality check started";
        break;
      case "READY_FOR_RETURN":
        requireOperator(actor); allowed(data.status === "QUALITY_CHECK", "Complete processing and quality check first");
        data.status = "READY_FOR_RETURN"; data.returnStatus = "READY"; label = "Quality checked; ready for return";
        break;
      case "START_RETURN":
        riderOnly(actor, row); allowed(data.status === "READY_FOR_RETURN", "Order is not ready for return");
        data.status = "RETURNING"; data.returnStatus = "ASSIGNED"; label = "Assigned rider started return";
        break;
      case "CONFIRM_PAYMENT":
        requireOperator(actor);
        allowed(data.status === "RETURNING", "Record collection at return");
        allowed(data.totalMinor > 0, "Nothing is due on this order");
        allowed(data.paymentStatus !== "PAID", "A receipt already exists");
        allowed(input.amountMinor === data.totalMinor, "Receipt amount must match the customer-approved total");
        await tx.query(`INSERT INTO pilot_receipts (order_id,amount_minor,method,reference,actor_id) VALUES ($1,$2,$3,$4,$5)`, [id, input.amountMinor, input.method, input.reference, actor.id]);
        data.paymentStatus = "PAID";
        label = `Founder recorded ${input.method} receipt (manual confirmation, not gateway capture)`;
        break;
      case "PAYMENT_ISSUE":
        if (actor.role === "rider") riderOnly(actor, row); else requireOperator(actor);
        allowed(data.totalMinor > 0, "Nothing is due on this order");
        allowed(data.status === "RETURNING" && data.paymentStatus !== "PAID", "Payment is already settled or return has not started");
        data.paymentStatus = "UNRESOLVED"; label = "Return payment unresolved: " + input.reason;
        break;
      case "DELIVER":
        riderOnly(actor, row); allowed(data.status === "RETURNING", "Return has not started");
        allowed(
          data.paymentStatus === "PAID" || data.totalMinor === 0,
          "Resolve payment with the founder before completing return",
          "PAYMENT_PENDING",
        );
        await verifyCode(tx, row, "RETURN", input.code);
        data.status = "DELIVERED"; data.returnStatus = "COMPLETED"; label = "Return handover confirmed by customer code";
        break;
      case "REISSUE_HANDOVER_CODE": {
        customerOnly(actor);
        allowed(!["DELIVERED", "CANCELLED"].includes(data.status), "This order is closed");
        if (input.leg === "PICKUP") {
          allowed(data.pickupStatus !== "COMPLETED", "Pickup is already complete");
          data.pickupCode = String(randomInt(100000, 1000000));
          data.pickupCodeExpiresAt = handoverExpiry(new Date(data.pickupEnd ?? data.pickupStart));
        } else {
          allowed(data.returnStatus !== "COMPLETED", "Return is already complete");
          data.returnCode = String(randomInt(100000, 1000000));
          data.returnCodeExpiresAt = handoverExpiry(new Date(data.returnEnd ?? data.returnStart));
        }
        await tx.query(`DELETE FROM pilot_handover_attempts WHERE order_id=$1 AND leg=$2`, [id, input.leg]);
        label = `Customer reissued the ${input.leg.toLowerCase()} handover code; the previous code and attempt lock are cleared`;
        break;
      }
      case "RESOLVE_HOLD": {
        requireOperator(actor);
        allowed(data.status === "ON_HOLD", "Only a held order can be released");
        allowed(input.customerAgreed === true, "Record the customer's agreement before releasing the bag");
        data.status = "RETURNING";
        data.returnStatus = row.rider_id ? "ASSIGNED" : "PENDING";
        data.totalMinor = 0;
        data.proposedTotalMinor = null;
        data.paymentStatus = "UNPAID";
        data.holdReason = null;
        label = `Held order released as an agreed unprocessed return; nothing due. Founder note: ${input.note}`;
        break;
      }
      case "CANCEL":
        customerOnly(actor); allowed(data.status === "BOOKED", "Contact the founder for cancellation after pickup");
        data.status = "CANCELLED";
        await tx.query(`UPDATE pilot_slots SET reserved=reserved-1 WHERE id=$1`, [row.slot_id]);
        label = "Customer cancelled before pickup; no charge; capacity released";
        break;
    }
    data.version++;
    data.riderId = row.rider_id;
    const updated = (await tx.query<PilotRow>(`UPDATE pilot_orders SET rider_id=$2,data=$3 WHERE id=$1 RETURNING *`, [id, row.rider_id, JSON.stringify(data)])).rows[0];
    await tx.query(`INSERT INTO pilot_events (order_id,actor_id,action,label) VALUES ($1,$2,$3,$4)`, [id, actor.id, input.action, label]);
    return pilotView(tx, updated, actor);
    },
    async (tx) => {
      loaded = (await tx.query<PilotRow>(`SELECT * FROM pilot_orders WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      requireAccess(loaded, actor);
    },
  );
}
