import { describe, expect, it } from "vitest";
import { v2 } from "@laundry/contracts";
import {
  MAX_BAG_LINES,
  MAX_PIECE_QUANTITY,
  addPieces,
  bagUnits,
  isBagLine,
  kgLine,
  pieceLine,
  removeBagLine,
  setKgCustodyCount,
  setKgWeightGrams,
  setPieceQuantity,
  toRequestedLines,
  type BagLine,
} from "./lines";

const WASH = "11111111-1111-4111-8111-111111111111";
const DC = "22222222-2222-4222-8222-222222222222";
const SHIRT = "33333333-3333-4333-8333-333333333333";
const KURTA = "44444444-4444-4444-8444-444444444444";

const garment = (id: string, name: string, active = true): v2.GarmentEligibility => ({
  id,
  name,
  eligibleServiceCodes: ["WASH_FOLD", "WASH_PRESS", "PRESS_ONLY", "DRY_CLEAN"],
  active,
});

function service(
  id: string,
  billingUnit: v2.Service["billingUnit"],
  overrides: Partial<v2.Service> = {},
): v2.Service {
  return {
    id,
    version: 3,
    code: "WASH_FOLD",
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
  };
}

describe("F01-01 bag lines map to wire requested lines", () => {
  it("maps piece lines to PIECE requested lines with garment and quantity", () => {
    const lines = addPieces([], WASH, SHIRT, 2);
    const mapped = toRequestedLines(lines, [service(WASH, "PIECE")]);
    expect(mapped.invalid).toEqual([]);
    expect(mapped.lines).toEqual([
      { serviceId: WASH, billingUnit: "PIECE", garmentTypeId: SHIRT, pieceQuantity: 2 },
    ]);
    expect(v2.requestedLineSchema.parse(mapped.lines[0])).toEqual(mapped.lines[0]);
  });

  it("maps a kg line to a KG requested line without garment or piece fields", () => {
    const lines = [kgLine(WASH, 2500, 4)];
    const mapped = toRequestedLines(lines, [service(WASH, "KG")]);
    expect(mapped.invalid).toEqual([]);
    expect(mapped.lines).toEqual([
      { serviceId: WASH, billingUnit: "KG", estimatedWeightGrams: 2500, declaredGarmentCount: 4 },
    ]);
    expect(v2.requestedLineSchema.parse(mapped.lines[0])).toEqual(mapped.lines[0]);
  });

  it("omits declaredGarmentCount when no custody count was declared", () => {
    const mapped = toRequestedLines([kgLine(WASH, 1500)], [service(WASH, "BOTH")]);
    expect(mapped.lines).toEqual([{ serviceId: WASH, billingUnit: "KG", estimatedWeightGrams: 1500 }]);
  });

  it("merges repeated piece adds for the same garment", () => {
    let lines = addPieces([], WASH, SHIRT, 1);
    lines = addPieces(lines, WASH, SHIRT, 2);
    expect(lines).toEqual([{ kind: "PIECE", serviceId: WASH, garmentTypeId: SHIRT, pieceQuantity: 3 }]);
    expect(bagUnits(lines)).toBe(3);
  });

  it("keeps one kg line per service", () => {
    let lines = setKgWeightGrams([], WASH, 1500);
    lines = setKgWeightGrams(lines, WASH, 2600);
    lines = setKgCustodyCount(lines, WASH, 2);
    expect(lines).toEqual([{ kind: "KG", serviceId: WASH, weightGrams: 2600, custodyCount: 2 }]);
    expect(bagUnits(lines)).toBe(1);
  });

  it("steppers read and set absolute quantities and remove at zero", () => {
    let lines = addPieces([], WASH, SHIRT, 1);
    lines = setPieceQuantity(lines, WASH, SHIRT, 5);
    expect(lines[0]).toMatchObject({ pieceQuantity: 5 });
    lines = setPieceQuantity(lines, WASH, SHIRT, 0);
    expect(lines).toEqual([]);
  });

  it("rejects invalid quantities and weights", () => {
    expect(() => pieceLine(WASH, SHIRT, 0)).toThrow();
    expect(() => pieceLine(WASH, SHIRT, -1)).toThrow();
    expect(() => pieceLine(WASH, SHIRT, 1.5)).toThrow();
    expect(() => pieceLine(WASH, SHIRT, MAX_PIECE_QUANTITY + 1)).toThrow();
    expect(() => kgLine(WASH, 0)).toThrow();
    expect(() => kgLine(WASH, -100)).toThrow();
    expect(() => setKgWeightGrams([], WASH, 0)).toThrow();
    expect(() => setKgCustodyCount([], WASH, -1)).toThrow();
  });

  it("caps the bag at the wire line budget", () => {
    let lines: BagLine[] = [];
    for (let i = 0; i < MAX_BAG_LINES; i++) {
      const garmentId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      lines = setPieceQuantity(lines, WASH, garmentId, 1);
    }
    expect(lines).toHaveLength(MAX_BAG_LINES);
    expect(() => addPieces(lines, DC, SHIRT, 1)).toThrow(/20/);
  });

  it("removes lines by index", () => {
    let lines = addPieces([], WASH, SHIRT, 1);
    lines = addPieces(lines, WASH, KURTA, 2);
    lines = removeBagLine(lines, 0);
    expect(lines).toEqual([{ kind: "PIECE", serviceId: WASH, garmentTypeId: KURTA, pieceQuantity: 2 }]);
  });

  it("flags stale lines instead of emitting broken wire requests", () => {
    const goneUnit = toRequestedLines([kgLine(WASH, 1000)], [service(WASH, "PIECE")]);
    expect(goneUnit.lines).toEqual([]);
    expect(goneUnit.invalid).toEqual([{ line: kgLine(WASH, 1000), reason: "UNIT_CHANGED" }]);

    const goneService = toRequestedLines([pieceLine(WASH, SHIRT, 1)], []);
    expect(goneService.lines).toEqual([]);
    expect(goneService.invalid[0]?.reason).toBe("SERVICE_MISSING");

    const goneGarment = toRequestedLines([pieceLine(WASH, "99999999-9999-4999-8999-999999999999", 1)], [service(WASH, "PIECE")]);
    expect(goneGarment.lines).toEqual([]);
    expect(goneGarment.invalid[0]?.reason).toBe("GARMENT_REMOVED");

    const inactive = toRequestedLines([pieceLine(WASH, SHIRT, 1)], [service(WASH, "PIECE", { active: false })]);
    expect(inactive.invalid[0]?.reason).toBe("SERVICE_INACTIVE");
  });
});

describe("F01-02 bag store persistence", () => {
  it("validates persisted bag lines and drops malformed entries", () => {
    expect(isBagLine({ kind: "PIECE", serviceId: WASH, garmentTypeId: SHIRT, pieceQuantity: 2 })).toBe(true);
    expect(isBagLine({ kind: "KG", serviceId: WASH, weightGrams: 1200 })).toBe(true);
    expect(isBagLine({ kind: "PIECE", serviceId: WASH, garmentTypeId: SHIRT, pieceQuantity: 0 })).toBe(false);
    expect(isBagLine({ kind: "KG", serviceId: WASH, weightGrams: -1 })).toBe(false);
    expect(isBagLine({ kind: "PIECE", serviceId: WASH, weightGrams: 100 })).toBe(false);
    expect(isBagLine(null)).toBe(false);
    expect(isBagLine("bag")).toBe(false);
  });
});
