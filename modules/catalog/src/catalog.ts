import type { Pool } from "pg";
import { ApiError } from "../../shared/src/errors";

export interface CatalogService {
  id: string; code: string; name: string; description: string; imageUrl: string;
  priceMinor: number; priceUnit: string; turnaroundHours: number;
  garments: { id: string; name: string; priceMinor: number }[];
  features: string[];
}

export async function listServices(db: Pool): Promise<CatalogService[]> {
  const services = (await db.query(`SELECT * FROM services WHERE active = TRUE ORDER BY name`)).rows;
  const garments = (await db.query(`SELECT * FROM garment_types`)).rows;
  return services.map((s) => ({
    id: s.id as string, code: s.code as string, name: s.name as string,
    description: s.description as string, imageUrl: s.image_url as string,
    priceMinor: s.price_minor as number, priceUnit: s.price_unit as string,
    turnaroundHours: s.turnaround_hours as number,
    garments: garments.filter((g) => g.service_id === s.id).map((g) => ({ id: g.id as string, name: g.name as string, priceMinor: g.price_minor as number })),
    features: (s.features ?? []) as string[],
  }));
}

export async function getService(db: Pool, id: string): Promise<CatalogService> {
  const s = (await db.query(`SELECT * FROM services WHERE id = $1 AND active = TRUE`, [id])).rows[0];
  if (!s) throw new ApiError("NOT_FOUND", "Service not found", { status: 404 });
  const garments = (await db.query(`SELECT * FROM garment_types WHERE service_id = $1`, [id])).rows;
  return {
    id: s.id as string, code: s.code as string, name: s.name as string,
    description: s.description as string, imageUrl: s.image_url as string,
    priceMinor: s.price_minor as number, priceUnit: s.price_unit as string,
    turnaroundHours: s.turnaround_hours as number,
    garments: garments.map((g) => ({ id: g.id as string, name: g.name as string, priceMinor: g.price_minor as number })),
    features: (s.features ?? []) as string[],
  };
}

export async function getRateCard(db: Pool): Promise<{ id: string; version: number }> {
  const row = (await db.query(`SELECT * FROM rate_cards ORDER BY version DESC LIMIT 1`)).rows[0];
  if (!row) throw new ApiError("PROVIDER_UNAVAILABLE", "Rate card not configured", { status: 502 });
  return { id: row.id as string, version: row.version as number };
}
