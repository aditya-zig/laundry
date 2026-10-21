import { describe, expect, it } from "vitest";
import { orderSchema, quoteInputSchema, quoteSchema, serviceSchema } from "@laundry/contracts";
import { DEMO_LABEL, demoOrder, demoQuote, demoQuoteInput, demoServices } from "../src/index.js";

describe("demo fixtures stay contract-valid", () => {
  it("labels every fixture as synthetic demo data", () => {
    expect(DEMO_LABEL).toMatch(/demo-only/i);
  });

  it("keeps services, quote input, quote, and order schema-valid", () => {
    for (const s of demoServices) expect(serviceSchema.safeParse(s).success).toBe(true);
    expect(quoteInputSchema.safeParse(demoQuoteInput).success).toBe(true);
    expect(quoteSchema.safeParse(demoQuote).success).toBe(true);
    expect(orderSchema.safeParse(demoOrder).success).toBe(true);
  });
});
