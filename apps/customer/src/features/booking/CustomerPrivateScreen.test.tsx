import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerPrivateScreen } from "./CustomerPrivateScreen";

const control = vi.hoisted(() => ({ state: "anonymous", role: "CUSTOMER", configured: true }));
vi.mock("../../foundation/session", () => ({
  onCustomerIdentityChange: () => () => undefined,
  getFoundation: () => {
    if (!control.configured) throw new Error("An explicit v2 API URL is required");
    return { snapshot: () => ({ state: control.state, actor: { id: "11111111-1111-4111-8111-111111111111", role: control.role } }) };
  },
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const component = ({ children }: { children?: React.ReactNode }) => createElement("div", {}, children);
  return { View: component, Text: component, Pressable: component, ScrollView: component, ActivityIndicator: component, StyleSheet: { create: (value: unknown) => value } };
});
function markup() { return renderToStaticMarkup(<CustomerPrivateScreen><span>PRIVATE_ORDER_RECORD</span></CustomerPrivateScreen>); }
beforeEach(() => { Object.assign(control, { state: "anonymous", role: "CUSTOMER", configured: true }); });
describe("customer private view boundary", () => {
  it("does not render private children while signed out or restoring", () => {
    for (const state of ["anonymous", "restoring", "restoreFailed"]) {
      control.state = state;
      expect(markup()).not.toContain("PRIVATE_ORDER_RECORD");
      expect(markup()).toContain("Sign in");
    }
  });
  it("does not treat staff authentication as a customer account", () => {
    control.state = "authenticated"; control.role = "OPERATOR";
    expect(markup()).toContain("Customer account required");
    expect(markup()).not.toContain("PRIVATE_ORDER_RECORD");
  });
  it("renders authenticated customer data only and fails closed without config", () => {
    control.state = "authenticated";
    expect(markup()).toContain("PRIVATE_ORDER_RECORD");
    control.configured = false;
    expect(markup()).not.toContain("PRIVATE_ORDER_RECORD");
    expect(markup()).toContain("not configured");
  });
});
