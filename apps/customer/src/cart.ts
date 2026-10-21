// Pure basket helpers. No framework imports, fully unit-testable.
export interface CartLine {
  serviceId: string;
  garmentTypeId: string;
  quantity: number;
  estimatedWeightGrams?: number;
  careNotes?: string;
}

export const MAX_GARMENTS = 100;
export const MAX_LINES = 20;

export function addLine(lines: CartLine[], line: CartLine): CartLine[] {
  if (lines.length >= MAX_LINES) throw new Error("Basket holds at most 20 distinct lines");
  const qty = Math.floor(line.quantity);
  if (qty < 1 || qty > 100) throw new Error("Quantity must be an integer from 1 to 100");
  const total = totalGarments(lines) + qty;
  if (total > MAX_GARMENTS) throw new Error("An order holds at most 100 garments");
  const key = (l: CartLine) =>
    `${l.serviceId}|${l.garmentTypeId}|${l.estimatedWeightGrams ?? ""}|${l.careNotes ?? ""}`;
  const existing = lines.findIndex((l) => key(l) === key(line));
  if (existing >= 0) {
    const next = [...lines];
    const merged = next[existing].quantity + qty;
    if (merged > 100) throw new Error("Quantity must be an integer from 1 to 100");
    if (totalGarments(next) - next[existing].quantity + merged > MAX_GARMENTS) {
      throw new Error("An order holds at most 100 garments");
    }
    next[existing] = { ...next[existing], quantity: merged };
    return next;
  }
  return [...lines, { ...line, quantity: qty }];
}

export function updateQuantity(lines: CartLine[], index: number, quantity: number): CartLine[] {
  const qty = Math.floor(quantity);
  if (qty < 1 || qty > 100) throw new Error("Quantity must be an integer from 1 to 100");
  const next = [...lines];
  next[index] = { ...next[index], quantity: qty };
  if (totalGarments(next) > MAX_GARMENTS) throw new Error("An order holds at most 100 garments");
  return next;
}

export function removeLine(lines: CartLine[], index: number): CartLine[] {
  return lines.filter((_, i) => i !== index);
}

/** Garment count across every basket line for one service+garment pair.
 * Tile steppers read this so merged and separate lines both count. */
export function countForGarment(
  lines: CartLine[],
  serviceId: string,
  garmentTypeId: string,
): number {
  return lines.reduce(
    (n, l) => (l.serviceId === serviceId && l.garmentTypeId === garmentTypeId ? n + l.quantity : n),
    0,
  );
}

/** Set the counted quantity of one service+garment pair.
 * 0 removes the matching lines entirely; surviving lines keep their care
 * notes, matching addLine merge semantics. Throws when the result would
 * exceed the pilot caps. */
export function setGarmentQuantity(
  lines: CartLine[],
  serviceId: string,
  garmentTypeId: string,
  next: number,
): CartLine[] {
  const want = Math.floor(next);
  if (want < 0 || want > MAX_GARMENTS) {
    throw new Error("Quantity must be an integer from 1 to 100");
  }
  const key = (l: CartLine) => l.serviceId === serviceId && l.garmentTypeId === garmentTypeId;
  const current = countForGarment(lines, serviceId, garmentTypeId);
  if (want === current) return lines;
  if (want === 0) return lines.filter((l) => !key(l));
  const delta = want - current;
  if (delta > 0) return addLine(lines, { serviceId, garmentTypeId, quantity: delta });
  let remaining = -delta;
  const out: CartLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!key(l)) {
      out.push(l);
      continue;
    }
    if (remaining >= l.quantity) {
      remaining -= l.quantity;
      continue;
    }
    out.push({ ...l, quantity: l.quantity - remaining });
    remaining = 0;
  }
  return out;
}

/** Client hint of the basket subtotal in minor units using catalog rates.
 * The server still owns the quote (tax, pickup fee, weight confirmation),
 * so callers must present this as an estimate. Returns null when any line
 * has no catalog price; the UI then shows "quote at checkout" instead. */
export function estimateSubtotalMinor(
  lines: CartLine[],
  priceByGarmentId: Record<string, number>,
): number | null {
  let total = 0;
  for (const l of lines) {
    const unit = priceByGarmentId[l.garmentTypeId];
    if (unit === undefined) return null;
    total += unit * l.quantity;
  }
  return total;
}

export function totalGarments(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

let draftAddressId: string | null = null;
export function getDraftAddressId(): string | null {
  return draftAddressId;
}
export function setDraftAddressId(id: string | null): void {
  draftAddressId = id;
}
