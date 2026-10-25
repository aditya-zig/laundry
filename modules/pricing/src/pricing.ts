import { v2 } from "@laundry/contracts";
import { ApiError } from "../../shared/src/errors";

/**
 * Authoritative integer pricing. Callers supply quantities and a rate snapshot;
 * they never supply amounts. All money is INR minor units.
 *
 * Weight is converted to minor units once, with half-up rounding to the nearest
 * paisa. Increment rounding is explicit on the card and applies to grams first.
 */
export type BillingUnit = "KG" | "PIECE";

export interface PriceLineInput {
  rateCard: v2.RateCard;
  billingUnit: BillingUnit;
  estimatedWeightGrams?: number;
  pieceQuantity?: number;
}

export interface PricedLine {
  unitPriceMinor: number;
  lineTotalMinor: number;
  provisional: boolean;
  billableWeightGrams?: number;
  components: v2.QuoteComponent[];
}

export interface PricedBasket {
  lines: PricedLine[];
  totalMinor: number;
  provisional: boolean;
  breakdown: v2.QuoteComponent[];
}

const SINGLETON_KINDS = new Set<v2.RateCardComponent["kind"]>([
  "BASE",
  "PER_KG",
  "PER_PIECE",
  "MINIMUM",
]);
// INCREMENT has no defined unit in the published contract. Inventing one would
// silently change approved prices, so a card that declares it is refused.
const UNSUPPORTED_KINDS = new Set<v2.RateCardComponent["kind"]>(["INCREMENT"]);

function safe(value: number, field: string): number {
  if (!Number.isSafeInteger(value)) throw new ApiError("INVALID_INPUT", `${field} exceeds the safe integer range`);
  return value;
}

/** Card-shape checks shared by draft creation and pricing. */
export function assertRateCardPricing(card: v2.RateCard): void {
  if (card.components.length === 0) throw new ApiError("INVALID_INPUT", "A rate card requires at least one component");
  const seen = new Set<string>();
  for (const component of card.components) {
    if (UNSUPPORTED_KINDS.has(component.kind)) {
      throw new ApiError("INVALID_INPUT", `Rate component ${component.kind} has no defined pricing unit`);
    }
    if (!Number.isSafeInteger(component.amountMinor)) {
      throw new ApiError("INVALID_INPUT", `Component ${component.label} must be an integer minor amount`);
    }
    if (component.kind === "TAX" || component.kind === "FEE") {
      if (component.amountMinor < 0) throw new ApiError("INVALID_INPUT", "Tax and fee components cannot be negative");
      continue;
    }
    if (component.amountMinor < 0) throw new ApiError("INVALID_INPUT", `Component ${component.label} cannot be negative`);
    if (SINGLETON_KINDS.has(component.kind)) {
      if (seen.has(component.kind)) throw new ApiError("INVALID_INPUT", `Duplicate ${component.kind} component`);
      seen.add(component.kind);
    }
  }
  if (card.components.some(c => c.kind === "PER_KG") && !card.weightIncrementGrams) {
    throw new ApiError("INVALID_INPUT", "Per-kilogram rates require an explicit weightIncrementGrams");
  }
}

function component(card: v2.RateCard, kind: v2.RateCardComponent["kind"]): v2.RateCardComponent | undefined {
  return card.components.find(c => c.kind === kind);
}

/** The published effective-rate summary carries one unit price per service. */
export function unitPriceMinor(card: v2.RateCard, billingUnit: "KG" | "PIECE" | "BOTH"): { amountMinor: number; label: string } {
  const perKg = component(card, "PER_KG"), perPiece = component(card, "PER_PIECE");
  const chosen = billingUnit === "PIECE" ? perPiece : billingUnit === "KG" ? perKg : perKg ?? perPiece;
  if (!chosen) throw new ApiError("NOT_FOUND", `Rate card does not price ${billingUnit}`);
  return { amountMinor: chosen.amountMinor, label: chosen.kind === "PER_KG" ? "per kg" : "per piece" };
}

function active(card: v2.RateCard, now: Date): void {
  if (!card.approvedAt || !card.activatedAt) throw new ApiError("NOT_FOUND", "No approved active rate card");
  if (new Date(card.effectiveFrom).getTime() > now.getTime()) throw new ApiError("NOT_FOUND", "Rate card is not yet effective");
}

export function billableWeightGrams(card: v2.RateCard, weightGrams: number): number {
  const minimum = card.minimumBillableGrams ?? 0;
  let grams = Math.max(weightGrams, minimum);
  const increment = card.weightIncrementGrams;
  if (increment) {
    const units = grams / increment;
    const rounded = card.rounding === "FLOOR" ? Math.floor(units) : card.rounding === "CEIL" ? Math.ceil(units) : units;
    grams = Math.round(rounded * increment);
  }
  return grams;
}

function gramsAmount(amountMinor: number, grams: number): number {
  // Half-up to the nearest paisa, then reject anything outside safe-integer money.
  return safe(Math.round((amountMinor * grams) / 1000), "Line total");
}

export function priceLine(input: PriceLineInput, now: Date = new Date()): PricedLine {
  const { rateCard, billingUnit } = input;
  assertRateCardPricing(rateCard);
  active(rateCard, now);
  const components: v2.QuoteComponent[] = [];
  let unitPrice = 0;
  let billableWeight: number | undefined;
  let subtotal = 0;

  if (billingUnit === "KG") {
    if (input.estimatedWeightGrams === undefined) throw new ApiError("INVALID_INPUT", "KG lines require estimatedWeightGrams");
    const perKg = component(rateCard, "PER_KG");
    if (!perKg) throw new ApiError("NOT_FOUND", "Rate card does not price KG");
    billableWeight = billableWeightGrams(rateCard, input.estimatedWeightGrams);
    unitPrice = perKg.amountMinor;
    const amount = gramsAmount(perKg.amountMinor, billableWeight);
    subtotal += amount;
    components.push({ label: perKg.label, kind: "PER_KG", amountMinor: amount });
  } else {
    if (input.pieceQuantity === undefined) throw new ApiError("INVALID_INPUT", "PIECE lines require pieceQuantity");
    const perPiece = component(rateCard, "PER_PIECE");
    if (!perPiece) throw new ApiError("NOT_FOUND", "Rate card does not price PIECE");
    unitPrice = perPiece.amountMinor;
    const amount = safe(perPiece.amountMinor * input.pieceQuantity, "Line total");
    subtotal += amount;
    components.push({ label: perPiece.label, kind: "PER_PIECE", amountMinor: amount });
  }

  const base = component(rateCard, "BASE");
  if (base) {
    subtotal += base.amountMinor;
    components.push({ label: base.label, kind: "BASE", amountMinor: base.amountMinor });
  }
  const minimum = component(rateCard, "MINIMUM");
  if (minimum && subtotal < minimum.amountMinor) {
    const delta = minimum.amountMinor - subtotal;
    subtotal = minimum.amountMinor;
    components.push({ label: minimum.label, kind: "MINIMUM", amountMinor: delta });
  }

  return {
    unitPriceMinor: unitPrice,
    lineTotalMinor: subtotal,
    provisional: billingUnit === "KG",
    ...(billableWeight === undefined ? {} : { billableWeightGrams: billableWeight }),
    components,
  };
}

export function priceBasket(rateCard: v2.RateCard, lines: Array<Omit<PriceLineInput, "rateCard">>, now: Date = new Date()): PricedBasket {
  if (lines.length === 0) throw new ApiError("INVALID_INPUT", "A basket requires at least one line");
  assertRateCardPricing(rateCard);
  active(rateCard, now);
  const priced = lines.map(line => priceLine({ rateCard, ...line }, now));
  const breakdown = priced.flatMap(line => line.components);
  let totalMinor = priced.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  for (const extra of rateCard.components) {
    if (extra.kind !== "TAX" && extra.kind !== "FEE") continue;
    totalMinor = safe(totalMinor + extra.amountMinor, "Basket total");
    breakdown.push({ label: extra.label, kind: extra.kind, amountMinor: extra.amountMinor });
  }
  return {
    lines: priced,
    totalMinor,
    provisional: priced.some(line => line.provisional),
    breakdown,
  };
}
