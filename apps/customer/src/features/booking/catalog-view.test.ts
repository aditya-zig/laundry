import { describe, expect, it } from "vitest";
import { v2 } from "@laundry/contracts";
import { catalogCardBookable, catalogEmptyReason, serviceCards, indexPublishedRates } from "./catalog-view";

const service = (patch: Partial<v2.Service>): v2.Service =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    version: 3,
    code: "WASH_PRESS",
    name: "Wash & press",
    description: "Washed and pressed.",
    imageUrl: "https://cdn.example.test/wash-press.png",
    billingUnit: "KG",
    turnaroundHours: 48,
    garments: [],
    features: [],
    careExclusions: [],
    active: true,
    ...patch,
  }) as v2.Service;

describe("serviceCards", () => {
  it("indexes the actual array wire response, including a single-service result", () => {
    const summary = v2.effectiveRateSummarySchema.parse({ serviceCode: "WASH_FOLD", billingUnit: "KG", unitPriceMinor: 4000, unitLabel: "per kg", synthetic: true });
    const indexed = indexPublishedRates([summary]);
    const [card] = serviceCards([service({ code: "WASH_FOLD" })], code => indexed[code]);
    expect(card.rate?.title).toBe("INR 40.00 per kg");
    expect(card.synthetic).toBe(true);
    expect(indexed.DRY_CLEAN).toBeUndefined();
    expect(indexPublishedRates([])).toEqual({});
  });
  it("labels weight and piece billing from server values", () => {
    const [weight, piece] = serviceCards([
      service({ billingUnit: "KG" }),
      service({ code: "PRESS_ONLY", billingUnit: "PIECE", name: "Pressing only" }),
    ]);
    expect(weight.unitTitle).toBe("Priced by weight");
    expect(piece.unitTitle).toBe("Priced per piece");
  });

  it("shows only the server-published rate summary, honestly absent otherwise", () => {
    const rate: v2.EffectiveRateSummary = {
      serviceCode: "WASH_PRESS",
      billingUnit: "KG",
      unitPriceMinor: 9900,
      unitLabel: "per kg",
      weightIncrementGrams: 100,
      synthetic: false,
    };
    const [withRate, withoutRate] = serviceCards(
      [service({}), service({ code: "DRY_CLEAN", name: "Dry cleaning", billingUnit: "PIECE" })],
      (code) => (code === "WASH_PRESS" ? rate : undefined),
    );
    expect(withRate.rate).toEqual({ title: "INR 99.00 per kg", sub: "Billed per 100 g" });
    expect(withoutRate.rate).toBeNull();
  });

  it("retains a synthetic-rate label instead of presenting demo prices as launch pricing", () => {
    const [card] = serviceCards([service({})], () => ({ serviceCode: "WASH_PRESS", billingUnit: "KG", unitPriceMinor: 9900, unitLabel: "per kg", weightIncrementGrams: 100, synthetic: true }));
    expect(card.synthetic).toBe(true);
  });

  it("marks paused services and keeps their rate visible but not bookable", () => {
    const [paused] = serviceCards([service({ active: false })]);
    expect(paused.paused).toBe(true);
    expect(catalogCardBookable(paused)).toBe(false);
    const [live] = serviceCards([service({ active: true })]);
    expect(catalogCardBookable(live)).toBe(true);
  });
});

describe("catalogEmptyReason", () => {
  it("distinguishes an absent catalog from an all-paused catalog", () => {
    expect(catalogEmptyReason([])).toBe("NO_CATALOG");
    expect(catalogEmptyReason([service({ active: false })])).toBe("ALL_PAUSED");
    expect(catalogEmptyReason([service({})])).toBeNull();
  });
});
