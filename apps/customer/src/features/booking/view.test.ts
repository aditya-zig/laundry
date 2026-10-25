import { describe, expect, it } from "vitest";
import { bagTotals, staleLabel, viewBagLines } from "./view";
import { kgLine, pieceLine } from "./lines";

const WASH = "11111111-1111-4111-8111-111111111111";
const DC = "22222222-2222-4222-8222-222222222222";
const SHIRT = "33333333-3333-4333-8333-333333333333";
const KURTA = "44444444-4444-4444-8444-444444444444";

const garment = (id: string, name: string): { id: string; name: string; eligibleServiceCodes: ("WASH_FOLD" | "WASH_PRESS" | "PRESS_ONLY" | "DRY_CLEAN")[]; active: boolean } => ({
  id,
  name,
  eligibleServiceCodes: ["WASH_FOLD", "WASH_PRESS", "PRESS_ONLY", "DRY_CLEAN"],
  active: true,
});

const service = (id: string, billingUnit: "KG" | "PIECE" | "BOTH", overrides: Record<string, unknown> = {}) => ({
  id,
  version: 3,
  code: "WASH_FOLD" as const,
  name: "Wash & fold",
  description: "Washed, dried and folded.",
  imageUrl: "https://example.com/wash-fold.png",
  billingUnit,
  turnaroundHours: 24,
  garments: [garment(SHIRT, "Shirt"), garment(KURTA, "Kurta")],
  features: [],
  careExclusions: [],
  active: true,
  ...overrides,
});

describe("F01-05 bag reconciliation against the server catalog", () => {
  it("labels ok lines with their service and garment", () => {
    const rows = viewBagLines([pieceLine(WASH, SHIRT, 2), kgLine(DC, 2500)], [service(WASH, "PIECE"), service(DC, "KG")]);
    expect(rows[0]).toMatchObject({ status: "ok", service: { id: WASH }, garment: { id: SHIRT } });
    expect(rows[1]).toMatchObject({ status: "ok", service: { id: DC } });
  });

  it("marks a line stale when the service disappeared", () => {
    const rows = viewBagLines([pieceLine(WASH, SHIRT, 1)], []);
    expect(rows[0]?.status).toBe("SERVICE_MISSING");
    const status = rows[0]?.status;
    if (!status || status === "ok") throw new Error("Expected a stale missing-service line");
    expect(staleLabel(status)).toMatch(/no longer offered/i);
  });

  it("marks a line stale when the service changed billing unit", () => {
    const rows = viewBagLines([kgLine(WASH, 1200)], [service(WASH, "PIECE")]);
    expect(rows[0]?.status).toBe("UNIT_CHANGED");
  });

  it("marks a piece line stale when the garment was removed", () => {
    const services = [service(WASH, "PIECE", { garments: [garment(KURTA, "Kurta")] })];
    const rows = viewBagLines([pieceLine(WASH, SHIRT, 1)], services);
    expect(rows[0]?.status).toBe("GARMENT_REMOVED");
    expect(staleLabel("GARMENT_REMOVED")).toMatch(/no longer part/i);
  });

  it("marks a line stale when the service was deactivated", () => {
    const rows = viewBagLines([pieceLine(WASH, SHIRT, 1)], [service(WASH, "PIECE", { active: false })]);
    expect(rows[0]?.status).toBe("SERVICE_INACTIVE");
  });

  it("counts only bookable lines in the booking totals", () => {
    const rows = viewBagLines([pieceLine(WASH, SHIRT, 2), pieceLine(WASH, KURTA, 1), kgLine(WASH, 900), pieceLine(DC, SHIRT, 1)], [service(WASH, "BOTH")]);
    const totals = bagTotals(rows);
    expect(totals).toEqual({ pieces: 3, byWeight: 1, units: 4 });
  });
});
