import { describe, expect, it } from "vitest";
import { addressFromFields, type AddressFields } from "./address-form";

// Synthetic coordinates, not an approved service area or physical acceptance.
const fields: AddressFields = { label: " Home ", line1: "10 Test Road", city: "Test City", postalCode: "560001", latitude: "12.97", longitude: "77.59" };
describe("owned address input", () => {
  it("keeps the customer's entered coordinates and lets the contract trim text", () => {
    expect(addressFromFields(fields)).toEqual({ label: "Home", line1: "10 Test Road", city: "Test City", postalCode: "560001", coordinates: { lat: 12.97, lng: 77.59 } });
  });
  it.each([{ latitude: "" }, { longitude: " " }, { latitude: "91" }, { longitude: "181" }, { latitude: "NaN" }, { postalCode: "123" }, { city: "" }])("rejects missing/invalid data without inventing coordinates: %j", patch => {
    expect(() => addressFromFields({ ...fields, ...patch })).toThrow();
  });
});
