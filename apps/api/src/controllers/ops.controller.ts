import { Controller, Get, Post, Put, Patch, Param, Body, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { getPool } from "../../../../modules/shared/src/db";
import { recordIntake, advanceCare } from "../../../../modules/orders/src/fulfillment";
import { postSupportMessage } from "../../../../modules/orders/src/support";
import { ApiError } from "../../../../modules/shared/src/errors";
import { AuthGuard } from "../guards/auth.guard";

function requireOps(role: string) {
  if (role !== "operator" && role !== "admin" && role !== "facility") throw new ApiError("FORBIDDEN", "Ops only", { status: 403 });
}

@Controller()
@UseGuards(AuthGuard)
export class OpsController {
  @Get("v1/ops/orders")
  async orders(@Req() req: { actor: { role: string } }) {
    requireOps(req.actor.role);
    const rows = (await getPool().query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 50`)).rows;
    const { getOrder } = await import("../../../../modules/orders/src/orders");
    const out = [];
    for (const r of rows) out.push(await getOrder(getPool(), { id: r.customer_id as string, role: "customer", scopes: [] }, r.id as string));
    return out;
  }

  @Post("v1/ops/orders/:id/intake")
  async intake(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string, @Body() body: unknown) {
    requireOps(req.actor.role);
    const parsed = z.object({
      expectedVersion: z.number().int().min(1),
      measuredLines: z.array(z.object({ orderLineId: z.string().uuid(), quantity: z.number().int().min(0).max(100), weightGrams: z.number().int().optional() })).min(1),
      bagIds: z.array(z.string().min(1)).default([]),
    }).parse(body);
    return recordIntake(getPool(), req.actor, id, parsed.expectedVersion, parsed.measuredLines, parsed.bagIds);
  }

  @Post("v1/ops/orders/:id/care")
  async care(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string, @Body() body: unknown) {
    requireOps(req.actor.role);
    const parsed = z.object({ expectedVersion: z.number().int().min(1), to: z.enum(["IN_CARE", "QUALITY_CHECK", "READY_FOR_RETURN"]) }).parse(body);
    return advanceCare(getPool(), req.actor, id, parsed.expectedVersion, parsed.to);
  }

  @Get("v1/ops/capacity")
  async getCapacity(@Req() req: { actor: { role: string } }) {
    requireOps(req.actor.role);
    const rows = (await getPool().query(`SELECT * FROM capacity_buckets ORDER BY window_start DESC LIMIT 50`)).rows;
    return rows;
  }

  @Put("v1/ops/capacity")
  async putCapacity(@Req() req: { actor: { role: string } }, @Body() body: unknown) {
    requireOps(req.actor.role);
    const parsed = z.object({ bucketKey: z.string().min(1), windowStart: z.string().datetime(), windowEnd: z.string().datetime(), capacityTotal: z.number().int().min(1).max(100) }).parse(body);
    const row = (await getPool().query(
      `INSERT INTO capacity_buckets (bucket_key, window_start, window_end, capacity_total, reserved)
       VALUES ($1,$2,$3,$4,0) ON CONFLICT (bucket_key) DO UPDATE SET capacity_total = EXCLUDED.capacity_total RETURNING *`,
      [parsed.bucketKey, parsed.windowStart, parsed.windowEnd, parsed.capacityTotal])).rows[0];
    return row;
  }

  @Patch("v1/ops/support/:id")
  async support(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string, @Body() body: unknown) {
    requireOps(req.actor.role);
    const parsed = z.object({ message: z.string().min(1).max(2000).optional(), status: z.string().optional() }).parse(body);
    if (parsed.status) {
      await getPool().query(`UPDATE support_incidents SET status = $1 WHERE id = $2`, [parsed.status, id]);
      return { id, status: parsed.status };
    }
    return postSupportMessage(getPool(), req.actor, id, parsed.message ?? "");
  }
}
