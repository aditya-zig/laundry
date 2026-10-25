import { describe, expect, it } from "vitest";
import { logoutNotice } from "../src/logout.js";

describe("truthful sign-out result", () => {
  it("does not call a device fully signed out when secure-store erasure failed", () => {
    for (const serverRevocationConfirmed of [true, false]) {
      const copy = logoutNotice({ localCredsCleared: false, serverRevocationConfirmed, revocationError: new Error("private-provider-detail") });
      expect(copy).toContain("could not be erased");
      expect(copy).not.toContain("private-provider-detail");
    }
  });
  it("distinguishes unconfirmed server revocation from full success", () => {
    expect(logoutNotice({ localCredsCleared: true, serverRevocationConfirmed: false, revocationError: null })).toContain("Server revocation was not confirmed");
    expect(logoutNotice({ localCredsCleared: true, serverRevocationConfirmed: true, revocationError: null })).toBe("Signed out on this device and the server.");
  });
});
