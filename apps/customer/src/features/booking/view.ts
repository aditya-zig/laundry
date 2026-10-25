import type { v2 } from "@laundry/contracts";
import type { BagLine, InvalidLineReason } from "./lines";

export interface BagRow {
  line: BagLine;
  status: "ok" | InvalidLineReason;
  service?: v2.Service;
  garment?: v2.GarmentEligibility;
}

export function viewBagLines(lines: BagLine[], services: v2.Service[]): BagRow[] {
  return lines.map((line) => {
    const service = services.find((candidate) => candidate.id === line.serviceId);
    if (!service) return { line, status: "SERVICE_MISSING" as const };
    if (!service.active) return { line, status: "SERVICE_INACTIVE" as const, service };
    if (line.kind === "KG") {
      if (service.billingUnit === "PIECE") return { line, status: "UNIT_CHANGED" as const, service };
      return { line, status: "ok" as const, service };
    }
    if (service.billingUnit === "KG") return { line, status: "UNIT_CHANGED" as const, service };
    const garment = service.garments.find((candidate) => candidate.id === line.garmentTypeId);
    if (!garment || !garment.active) return { line, status: "GARMENT_REMOVED" as const, service };
    return { line, status: "ok" as const, service, garment };
  });
}

export function staleLabel(status: InvalidLineReason): string {
  switch (status) {
    case "SERVICE_MISSING":
      return "This service is no longer offered.";
    case "SERVICE_INACTIVE":
      return "This service is paused right now.";
    case "UNIT_CHANGED":
      return "This service now bills differently. Remove it and add it again.";
    case "GARMENT_REMOVED":
      return "This item is no longer part of the service.";
  }
}

export interface BagTotals {
  pieces: number;
  byWeight: number;
  units: number;
}

export function bagTotals(rows: BagRow[]): BagTotals {
  let pieces = 0;
  let byWeight = 0;
  for (const row of rows) {
    if (row.status !== "ok") continue;
    if (row.line.kind === "PIECE") pieces += row.line.pieceQuantity;
    else byWeight += 1;
  }
  return { pieces, byWeight, units: pieces + byWeight };
}
