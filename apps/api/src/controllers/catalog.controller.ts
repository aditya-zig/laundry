import { Controller, Get, Post, Patch, Param, Body, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { getPool } from "../../../../modules/shared/src/db";
import { listServices, getService } from "../../../../modules/catalog/src/catalog";
import { submitReview, listServiceReviews, moderateReview } from "../../../../modules/orders/src/support";
import { reviewInputSchema } from "@laundry/contracts";
import { AuthGuard, Public } from "../guards/auth.guard";
import { ApiError } from "../../../../modules/shared/src/errors";

@Controller()
export class CatalogController {
  @Public()
  @Get("v1/service-areas/check")
  async check() {
    return { serviceable: true, areaId: "demo-area-bengaluru", hours: "09:00-18:00 Asia/Kolkata" };
  }

  @Public()
  @Get("v1/services")
  async list() {
    return listServices(getPool());
  }

  @Public()
  @Get("v1/services/:id")
  async one(@Param("id") id: string) {
    return getService(getPool(), id);
  }

  @Public()
  @Get("v1/services/:id/reviews")
  async reviews(@Param("id") id: string) {
    return listServiceReviews(getPool(), id);
  }

  @Post("v1/reviews")
  @UseGuards(AuthGuard)
  async create(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Body() body: unknown) {
    const parsed = reviewInputSchema.parse(body);
    return submitReview(getPool(), req.actor, parsed);
  }

  @Post("v1/ops/services")
  @UseGuards(AuthGuard)
  async upsertService(@Req() req: { actor: { role: string } }, @Body() body: unknown) {
    if (req.actor.role !== "operator" && req.actor.role !== "admin") throw new ApiError("FORBIDDEN", "Ops only", { status: 403 });
    const parsed = z.object({
      id: z.string().uuid().optional(), code: z.enum(["WASH_FOLD", "WASH_PRESS", "PRESS_ONLY", "DRY_CLEAN"]),
      name: z.string().min(1), description: z.string().min(1), imageUrl: z.string().url(),
      priceMinor: z.number().int().min(0), priceUnit: z.string().min(1), turnaroundHours: z.number().int().positive(),
      features: z.array(z.string()).default([]),
    }).parse(body);
    const db = getPool();
    const id = parsed.id ?? crypto.randomUUID();
    await db.query(
      `INSERT INTO services (id, code, name, description, image_url, price_minor, price_unit, turnaround_hours, features, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, price_minor = EXCLUDED.price_minor`,
      [id, parsed.code, parsed.name, parsed.description, parsed.imageUrl, parsed.priceMinor, parsed.priceUnit, parsed.turnaroundHours, JSON.stringify(parsed.features)],
    );
    return getService(db, id);
  }

  @Post("v1/ops/rate-cards")
  @UseGuards(AuthGuard)
  async rateCard(@Req() req: { actor: { role: string } }) {
    if (req.actor.role !== "operator" && req.actor.role !== "admin") throw new ApiError("FORBIDDEN", "Ops only", { status: 403 });
    const row = (await getPool().query(`INSERT INTO rate_cards (version, currency) SELECT COALESCE(MAX(version),0)+1, 'INR' FROM rate_cards RETURNING id, version`)).rows[0];
    return row;
  }

  @Patch("v1/ops/reviews/:id")
  @UseGuards(AuthGuard)
  async moderate(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string, @Body() body: unknown) {
    const parsed = z.object({ approve: z.boolean() }).parse(body);
    return moderateReview(getPool(), req.actor, id, parsed.approve);
  }
}
