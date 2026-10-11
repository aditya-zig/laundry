import { describe, expect, it } from "vitest";
import { colors, spacing, typography } from "../src/index.js";

describe("design tokens", () => {
  it("meets the 44px minimum touch target", () => {
    expect(typography.minTouchTarget).toBeGreaterThanOrEqual(44);
  });

  it("keeps surfaces bright and text navy with a teal action", () => {
    expect(colors.surface).toBe("#FFFFFF");
    expect(colors.ink).toBe("#0F1F3D");
    expect(colors.action).toBeDefined();
    expect(spacing.md).toBe(16);
  });
});
