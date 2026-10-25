import { v2 } from "@laundry/contracts";

export type BagLine =
  | { kind: "PIECE"; serviceId: string; garmentTypeId: string; pieceQuantity: number }
  | { kind: "KG"; serviceId: string; weightGrams: number; custodyCount?: number };

export const MAX_BAG_LINES = 20;
export const MAX_PIECE_QUANTITY = 999;
export const MAX_KG_GRAMS = 100_000;

export type InvalidLineReason = "SERVICE_MISSING" | "SERVICE_INACTIVE" | "UNIT_CHANGED" | "GARMENT_REMOVED";

function requirePositiveInt(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Enter a whole ${label} of at least 1`);
  return value;
}

function limitLines(lines: BagLine[]): BagLine[] {
  if (lines.length > MAX_BAG_LINES) throw new Error(`Your bag holds up to ${MAX_BAG_LINES} lines. Remove one to add more.`);
  return lines;
}

export function pieceLine(serviceId: string, garmentTypeId: string, pieceQuantity: number): BagLine {
  requirePositiveInt(pieceQuantity, "item count");
  if (pieceQuantity > MAX_PIECE_QUANTITY) throw new Error(`Up to ${MAX_PIECE_QUANTITY} per item in one line`);
  return { kind: "PIECE", serviceId, garmentTypeId, pieceQuantity };
}

export function kgLine(serviceId: string, weightGrams: number, custodyCount?: number): BagLine {
  requirePositiveInt(weightGrams, "weight in grams");
  if (weightGrams > MAX_KG_GRAMS) throw new Error(`Up to ${MAX_KG_GRAMS} grams per line`);
  const line: BagLine = { kind: "KG", serviceId, weightGrams };
  if (custodyCount !== undefined) {
    if (!Number.isInteger(custodyCount) || custodyCount < 0) throw new Error("Custody count must be a whole number");
    line.custodyCount = custodyCount;
  }
  return line;
}

export function pieceCountFor(lines: BagLine[], serviceId: string, garmentTypeId: string): number {
  for (const line of lines) {
    if (line.kind === "PIECE" && line.serviceId === serviceId && line.garmentTypeId === garmentTypeId) return line.pieceQuantity;
  }
  return 0;
}

export function kgLineFor(lines: BagLine[], serviceId: string): BagLine | undefined {
  for (const line of lines) {
    if (line.kind === "KG" && line.serviceId === serviceId) return line;
  }
  return undefined;
}

export function addPieces(lines: BagLine[], serviceId: string, garmentTypeId: string, count: number): BagLine[] {
  requirePositiveInt(count, "item count");
  const current = pieceCountFor(lines, serviceId, garmentTypeId);
  return setPieceQuantity(lines, serviceId, garmentTypeId, current + count);
}

export function setPieceQuantity(lines: BagLine[], serviceId: string, garmentTypeId: string, quantity: number): BagLine[] {
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error("Item count must be a whole number of 0 or more");
  if (quantity > MAX_PIECE_QUANTITY) throw new Error(`Up to ${MAX_PIECE_QUANTITY} per item in one line`);
  const next = lines.filter((line) => !(line.kind === "PIECE" && line.serviceId === serviceId && line.garmentTypeId === garmentTypeId));
  if (quantity === 0) return next;
  next.push({ kind: "PIECE", serviceId, garmentTypeId, pieceQuantity: quantity });
  return limitLines(next);
}

export function setKgWeightGrams(lines: BagLine[], serviceId: string, weightGrams: number): BagLine[] {
  requirePositiveInt(weightGrams, "weight in grams");
  if (weightGrams > MAX_KG_GRAMS) throw new Error(`Up to ${MAX_KG_GRAMS} grams per line`);
  const next = lines.filter((line) => !(line.kind === "KG" && line.serviceId === serviceId));
  const existing = lines.find((line): line is Extract<BagLine, { kind: "KG" }> => line.kind === "KG" && line.serviceId === serviceId);
  next.push({ kind: "KG", serviceId, weightGrams, ...(existing?.custodyCount === undefined ? {} : { custodyCount: existing.custodyCount }) });
  return limitLines(next);
}

export function setKgCustodyCount(lines: BagLine[], serviceId: string, custodyCount: number | undefined): BagLine[] {
  if (custodyCount !== undefined && (!Number.isInteger(custodyCount) || custodyCount < 0)) throw new Error("Custody count must be a whole number");
  return lines.map((line) => {
    if (line.kind !== "KG" || line.serviceId !== serviceId) return line;
    if (custodyCount === undefined) {
      return { kind: "KG", serviceId: line.serviceId, weightGrams: line.weightGrams };
    }
    return { kind: "KG", serviceId: line.serviceId, weightGrams: line.weightGrams, custodyCount };
  });
}

export function removeBagLine(lines: BagLine[], index: number): BagLine[] {
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) throw new Error("That bag line is gone. Refresh and try again.");
  return lines.filter((_, at) => at !== index);
}

export function bagUnits(lines: BagLine[]): number {
  let units = 0;
  for (const line of lines) {
    if (line.kind === "PIECE") units += line.pieceQuantity;
    else units += 1;
  }
  return units;
}

export function isBagLine(value: unknown): value is BagLine {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.serviceId !== "string") return false;
  if (candidate.kind === "PIECE") {
    return typeof candidate.garmentTypeId === "string" && typeof candidate.pieceQuantity === "number" &&
      Number.isInteger(candidate.pieceQuantity) && candidate.pieceQuantity > 0;
  }
  if (candidate.kind === "KG") {
    if (typeof candidate.weightGrams !== "number" || !Number.isInteger(candidate.weightGrams) || candidate.weightGrams <= 0) return false;
    if (candidate.custodyCount !== undefined && (typeof candidate.custodyCount !== "number" || !Number.isInteger(candidate.custodyCount) || candidate.custodyCount < 0)) return false;
    return true;
  }
  return false;
}

export interface RequestedLinesResult {
  lines: v2.RequestedLine[];
  invalid: Array<{ line: BagLine; reason: InvalidLineReason }>;
}

export function toRequestedLines(lines: BagLine[], services: v2.Service[]): RequestedLinesResult {
  const out: v2.RequestedLine[] = [];
  const invalid: RequestedLinesResult["invalid"] = [];
  for (const line of lines) {
    const service = services.find((candidate) => candidate.id === line.serviceId);
    if (!service) {
      invalid.push({ line, reason: "SERVICE_MISSING" });
      continue;
    }
    if (!service.active) {
      invalid.push({ line, reason: "SERVICE_INACTIVE" });
      continue;
    }
    if (line.kind === "PIECE") {
      if (service.billingUnit === "KG") {
        invalid.push({ line, reason: "UNIT_CHANGED" });
        continue;
      }
      const garment = service.garments.find((candidate) => candidate.id === line.garmentTypeId);
      if (!garment || !garment.active) {
        invalid.push({ line, reason: "GARMENT_REMOVED" });
        continue;
      }
      out.push({ serviceId: line.serviceId, billingUnit: "PIECE", garmentTypeId: line.garmentTypeId, pieceQuantity: line.pieceQuantity });
    } else {
      if (service.billingUnit === "PIECE") {
        invalid.push({ line, reason: "UNIT_CHANGED" });
        continue;
      }
      const requested: v2.RequestedLine = { serviceId: line.serviceId, billingUnit: "KG", estimatedWeightGrams: line.weightGrams };
      if (line.custodyCount !== undefined) requested.declaredGarmentCount = line.custodyCount;
      out.push(requested);
    }
  }
  return { lines: out, invalid };
}
