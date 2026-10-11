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

export function totalGarments(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}
