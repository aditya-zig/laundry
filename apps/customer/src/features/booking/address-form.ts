import { v2 } from "@laundry/contracts";

export interface AddressFields { label: string; line1: string; city: string; postalCode: string; latitude: string; longitude: string }

export function addressFromFields(fields: AddressFields): v2.AddressInput {
  if (!fields.latitude.trim() || !fields.longitude.trim()) throw new Error("Choose the pickup location or enter both coordinates. No default location is used.");
  return v2.addressInputSchema.parse({
    label: fields.label, line1: fields.line1, city: fields.city, postalCode: fields.postalCode,
    coordinates: { lat: Number(fields.latitude.trim()), lng: Number(fields.longitude.trim()) },
  });
}
