import { describe, expect, it } from "vitest";
import { colors, spacing, typography } from "../src/index.js";

describe("design tokens", () => {
  it("meets the 44px minimum touch target", () => {
    expect(typography.minTouchTarget).toBeGreaterThanOrEqual(44);
  });

  it("keeps spacing scale and an action color defined", () => {
    expect(colors.action).toBeDefined();
    expect(spacing.md).toBe(16);
  });
});
