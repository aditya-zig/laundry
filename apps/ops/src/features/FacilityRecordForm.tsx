import { useState, type FormEvent } from "react";
import { v2 } from "@laundry/contracts";
import type { FacilityRecordInput } from "./careActions";
import { shortId } from "./format";

type Mode = FacilityRecordInput["kind"];
export interface BagDraft {
  id: string;
  sealId: string;
  sealed: boolean;
  condition: v2.CustodyCondition | "";
  garmentCount: string;
  weightGrams: string;
}
export interface MeasurementDraft {
  orderLineId: string;
  quantity: string;
  countedQuantity: string;
  condition: v2.CustodyCondition | "";
  note: string;
}
export interface FacilityDraft {
  bags: BagDraft[];
  lines: MeasurementDraft[];
  result: "" | "PASS" | "REWORK";
  note: string;
  confirmed: boolean;
}
const CONDITIONS = [["GOOD", "Good"], ["DAMAGED", "Damaged"], ["STAINTED", "Stained"], ["MISSING", "Missing"]] as const;
function quantity(text: string, label: string): number {
  if (!/^\d+$/.test(text.trim())) throw new Error(`${label} must be a whole, non-negative number. Enter zero explicitly if appropriate.`);
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new Error(`${label} is too large.`);
  return value;
}

/** Translate only recorded facts; never substitute estimates or accessory counts
 * for billed weight/pieces. This boundary is shared by form and behavior tests. */
export function parseFacilityRecord(mode: Mode, order: v2.Order, draft: FacilityDraft): FacilityRecordInput {
  if (!draft.confirmed) throw new Error("Confirm the physical measurements, bag identities and inspection before recording.");
  const containers = draft.bags.map(bag => {
    if (!bag.sealId.trim()) throw new Error("Enter the physical seal or bag label for every bag.");
    return { id: bag.id, sealId: bag.sealId.trim(), sealed: bag.sealed, condition: bag.condition,
      garmentCount: quantity(bag.garmentCount, "Bag garment count"),
      ...(bag.weightGrams.trim() ? { weightGrams: quantity(bag.weightGrams, "Bag weight") } : {}),
    };
  });
  if (new Set(containers.map(bag => bag.sealId)).size !== containers.length) throw new Error("Physical bag labels must be unique.");
  if (new Set(containers.map(bag => bag.id)).size !== containers.length) throw new Error("Bag inventory IDs must be unique.");
  if (mode === "QUALITY_CHECK") {
    if (!draft.result) throw new Error("Choose the actual inspection result.");
    return { kind: mode, orderId: order.id, record: v2.qualityCheckSchema.parse({
      expectedVersion: order.version, passed: draft.result === "PASS", containers, mediaIds: [],
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    }) };
  }
  if (draft.lines.length !== order.lines.length || new Set(draft.lines.map(line => line.orderLineId)).size !== order.lines.length) throw new Error("Record each order line exactly once.");
  const lines = order.lines.map(line => {
    const measured = draft.lines.find(item => item.orderLineId === line.orderLineId);
    if (!measured) throw new Error("An order line is missing its measurements.");
    return { orderLineId: line.orderLineId, condition: measured.condition,
      countedQuantity: quantity(measured.countedQuantity, "Counted items"),
      ...(line.billingUnit === "KG" ? { measuredWeightGrams: quantity(measured.quantity, "Measured weight") }
        : { measuredPieceQuantity: quantity(measured.quantity, "Billable pieces") }),
      ...(measured.note.trim() ? { note: measured.note.trim() } : {}),
    };
  });
  return { kind: mode, orderId: order.id, record: v2.intakeRecordSchema.parse({ expectedVersion: order.version, lines, containers, mediaIds: [] }) };
}

export function FacilityRecordForm(props: {
  mode: Mode;
  order: v2.Order;
  disabled: boolean;
  onRecord?: (input: FacilityRecordInput) => void;
}) {
  const { mode, order } = props;
  const newBag = (): BagDraft => ({ id: crypto.randomUUID(), sealId: "", sealed: false, condition: "", garmentCount: "", weightGrams: "" });
  const [draft, setDraft] = useState<FacilityDraft>(() => ({
    bags: mode === "QUALITY_CHECK" && order.containers.length ? order.containers.map(bag => ({
      id: bag.id, sealId: bag.sealId ?? "", sealed: bag.sealed, condition: bag.condition,
      garmentCount: String(bag.garmentCount), weightGrams: bag.weightGrams === undefined ? "" : String(bag.weightGrams),
    })) : [newBag()],
    lines: order.lines.map(line => ({ orderLineId: line.orderLineId, quantity: "", countedQuantity: "", condition: "", note: "" })),
    result: "", note: "", confirmed: false,
  }));
  const [error, setError] = useState("");
  const updateBag = (index: number, patch: Partial<BagDraft>) => setDraft(value => ({ ...value, confirmed: false, bags: value.bags.map((bag, i) => i === index ? { ...bag, ...patch } : bag) }));
  const updateLine = (index: number, patch: Partial<MeasurementDraft>) => setDraft(value => ({ ...value, confirmed: false, lines: value.lines.map((line, i) => i === index ? { ...line, ...patch } : line) }));
  function submit(event: FormEvent) {
    event.preventDefault();
    if (props.disabled) return;
    try { const record = parseFacilityRecord(mode, order, draft); setError(""); props.onRecord?.(record); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Check the measured facts."); }
  }
  const conditionField = (id: string, value: BagDraft["condition"], onChange: (value: BagDraft["condition"]) => void) => (
    <>
      <label className="ops-label" htmlFor={id}>Condition</label>
      <select className="ops-input" id={id} required value={value} onChange={event => onChange(event.target.value as BagDraft["condition"])}>
        <option value="">Select actual condition</option>
        {CONDITIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      </select>
    </>
  );
  return (
    <form onSubmit={submit} data-testid={mode === "INTAKE" ? "ops-intake-form" : "ops-quality-form"}>
      <fieldset className="ops-record-fields" disabled={props.disabled}>
        <legend className="ops-h3">{mode === "INTAKE" ? "Record measured intake" : "Record quality check"}</legend>
        <p className="ops-mini ops-muted">Record physical facts, not booking estimates. A higher measured price requires the customer's separate consent.</p>
        {mode === "INTAKE" && order.lines.map((line, index) => (
          <fieldset className="ops-record-group" key={line.orderLineId}>
            <legend>Line {index + 1} · {shortId(line.serviceId)} · {line.billingUnit}</legend>
            <label className="ops-label" htmlFor={`measure-${line.orderLineId}`}>{line.billingUnit === "KG" ? "Measured weight (grams)" : "Measured billable pieces"}
              <input className="ops-input" id={`measure-${line.orderLineId}`} inputMode="numeric" required value={draft.lines[index].quantity} onChange={e => updateLine(index, { quantity: e.target.value })} />
            </label>
            <label className="ops-label" htmlFor={`count-${line.orderLineId}`}>Counted items (including accessories)
              <input className="ops-input" id={`count-${line.orderLineId}`} inputMode="numeric" required value={draft.lines[index].countedQuantity} onChange={e => updateLine(index, { countedQuantity: e.target.value })} />
            </label>
            {conditionField(`condition-${line.orderLineId}`, draft.lines[index].condition, condition => updateLine(index, { condition }))}
            <label className="ops-label" htmlFor={`note-${line.orderLineId}`}>Condition note (optional)
              <input className="ops-input" id={`note-${line.orderLineId}`} maxLength={2000} value={draft.lines[index].note} onChange={e => updateLine(index, { note: e.target.value })} />
            </label>
          </fieldset>
        ))}
        {mode === "QUALITY_CHECK" && <>
          <label className="ops-label" htmlFor="qc-result">Inspection result</label>
          <select id="qc-result" className="ops-input" required value={draft.result} onChange={e => setDraft(value => ({ ...value, confirmed: false, result: e.target.value as FacilityDraft["result"] }))}>
            <option value="">Select result</option><option value="PASS">Passed inspection</option><option value="REWORK">Failed — return to care</option>
          </select>
          <label className="ops-label" htmlFor="qc-note">Inspection note (required for rework)
            <textarea id="qc-note" className="ops-input" required={draft.result === "REWORK"} maxLength={2000} value={draft.note} onChange={e => setDraft(value => ({ ...value, confirmed: false, note: e.target.value }))} />
          </label>
        </>}
        {draft.bags.map((bag, index) => <fieldset className="ops-record-group" key={bag.id}>
          <legend>Physical bag {index + 1}</legend>
          <label className="ops-label" htmlFor={`seal-${bag.id}`}>Seal or bag label
            <input className="ops-input" id={`seal-${bag.id}`} required maxLength={200} value={bag.sealId} onChange={e => updateBag(index, { sealId: e.target.value })} />
          </label>
          <label className="ops-label" htmlFor={`garments-${bag.id}`}>Garments in this bag
            <input className="ops-input" id={`garments-${bag.id}`} inputMode="numeric" required value={bag.garmentCount} onChange={e => updateBag(index, { garmentCount: e.target.value })} />
          </label>
          <label className="ops-label" htmlFor={`weight-${bag.id}`}>Bag weight in grams (optional)
            <input className="ops-input" id={`weight-${bag.id}`} inputMode="numeric" value={bag.weightGrams} onChange={e => updateBag(index, { weightGrams: e.target.value })} />
          </label>
          {conditionField(`bag-condition-${bag.id}`, bag.condition, condition => updateBag(index, { condition }))}
          <label className="ops-label ops-check"><input type="checkbox" checked={bag.sealed} onChange={e => updateBag(index, { sealed: e.target.checked })} /> Physically sealed</label>
          {draft.bags.length > 1 && <button type="button" className="ops-ghost" onClick={() => setDraft(value => ({ ...value, confirmed: false, bags: value.bags.filter((_, i) => i !== index) }))}>Remove bag {index + 1}</button>}
        </fieldset>)}
        <button type="button" className="ops-ghost" disabled={draft.bags.length >= 100} onClick={() => setDraft(value => ({ ...value, confirmed: false, bags: [...value.bags, newBag()] }))}>Add physical bag</button>
        <p className="ops-mini ops-muted">No photos are attached by this form. Do not invent an attachment; report evidence-dependent exceptions to support.</p>
        <label className="ops-label ops-check"><input type="checkbox" required checked={draft.confirmed} onChange={e => setDraft(value => ({ ...value, confirmed: e.target.checked }))} /> I checked the physical facts and bag labels.</label>
        <button className="ops-primary" type="submit">{mode === "INTAKE" ? "Submit measured intake" : "Submit inspection"}</button>
      </fieldset>
      {error && <p className="ops-notice ops-notice-error" role="alert">{error}</p>}
    </form>
  );
}
