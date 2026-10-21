import { Controller, Get, Post, Param, Body, Req, UseGuards, Headers } from "@nestjs/common";
import { z } from "zod";
import { getPool } from "../../../../modules/shared/src/db";
import { listPartnerJobs, acceptJob, recordHandover, reportException, opsDispatch, opsCancelDelivery } from "../../../../modules/logistics/src/logistics";
import { handoverInputSchema } from "@laundry/contracts";
import { AuthGuard } from "../guards/auth.guard";
import { ApiError } from "../../../../modules/shared/src/errors";

@Controller()
@UseGuards(AuthGuard)
export class PartnerController {
  @Get("v1/partner/jobs")
  async list(@Req() req: { actor: { id: string; role: string; scopes: string[] } }) {
    return listPartnerJobs(getPool(), req.actor);
  }

  @Get("v1/partner/jobs/:id")
  async one(@Req() req: { actor: { id: string; role: string } }, @Param("id") id: string) {
    if (req.actor.role !== "rider") throw new ApiError("FORBIDDEN", "Riders only", { status: 403 });
    const row = (await getPool().query(`SELECT * FROM delivery_jobs WHERE id = $1`, [id])).rows[0];
    if (!row || (row.assigned_to !== req.actor.id && row.assigned_to !== null)) throw new ApiError("NOT_FOUND", "Delivery job not found", { status: 404 });
    const { toJob } = await import("../../../../modules/orders/src/orders");
    return toJob(row);
  }

  @Post("v1/partner/jobs/:id/accept")
  async accept(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string) {
    return acceptJob(getPool(), req.actor, id);
  }

  @Post("v1/partner/jobs/:id/handover")
  async handover(
    @Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const parsed = handoverInputSchema.extend({ expectedVersion: z.number().int().min(1) }).parse({ ...(body as object), jobId: id });
    return recordHandover(getPool(), req.actor, parsed, parsed.expectedVersion);
  }

  @Post("v1/partner/jobs/:id/exception")
  async exception(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string, @Body() body: unknown) {
    const parsed = z.object({ reason: z.string().min(1).max(500) }).parse(body);
    return reportException(getPool(), req.actor, id, parsed.reason);
  }

  @Get("v1/ops/deliveries")
  async opsList(@Req() req: { actor: { role: string } }) {
    if (req.actor.role !== "operator" && req.actor.role !== "admin") throw new ApiError("FORBIDDEN", "Ops only", { status: 403 });
    const { toJob } = await import("../../../../modules/orders/src/orders");
    const rows = (await getPool().query(`SELECT * FROM delivery_jobs ORDER BY created_at DESC LIMIT 100`)).rows;
    return rows.map(toJob);
  }

  @Post("v1/ops/deliveries/:id/dispatch")
  async dispatch(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string) {
    return opsDispatch(getPool(), req.actor, id);
  }

  @Post("v1/ops/deliveries/:id/cancel")
  async cancelDelivery(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string, @Body() body: unknown) {
    const parsed = z.object({ reason: z.string().min(1).max(500) }).parse(body);
    return opsCancelDelivery(getPool(), req.actor, id, parsed.reason);
  }

  @Post("v1/demo/media/handover-proof")
  async proof(@Req() req: { actor: { role: string } }, @Body() body: unknown, @Headers() headers: Record<string, unknown>) {
    void body; void headers;
    if (req.actor.role !== "rider" && req.actor.role !== "operator") throw new ApiError("FORBIDDEN", "Riders only", { status: 403 });
    return { proofReference: `proof_${Date.now()}`, note: "demo media reference; photos alone never complete a handover" };
  }
}
