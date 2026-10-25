import { Controller, Get, Post, Param, Body, Req, UseGuards, Headers } from "@nestjs/common";
import { z } from "zod";
import { idSchema } from "@laundry/contracts";
import { getPool } from "../../../../modules/shared/src/db";
import { getPayment, listReceipts, requestRefund, reconciliation } from "../../../../modules/billing/src/billing";
import { AuthGuard, Public } from "../guards/auth.guard";
import { ApiError } from "../../../../modules/shared/src/errors";

@Controller()
export class BillingController {
  @Get("v1/payments/:id")
  @UseGuards(AuthGuard)
  async one(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string) {
    return getPayment(getPool(), req.actor, id);
  }

  @Get("v1/orders/:id/receipts")
  @UseGuards(AuthGuard)
  async receipts(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string) {
    return listReceipts(getPool(), req.actor, id);
  }

  @Post("v1/ops/refunds")
  @UseGuards(AuthGuard)
  async refund(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Body() body: unknown, @Headers() headers: Record<string, unknown>) {
    void headers;
    const parsed = z.object({
      orderId: idSchema, paymentId: idSchema, amountMinor: z.number().int().positive(),
      reason: z.string().min(1).max(500), obligationId: idSchema.optional(),
    }).parse(body);
    return requestRefund(getPool(), req.actor, parsed);
  }

  @Get("v1/ops/reconciliation")
  @UseGuards(AuthGuard)
  async recon(@Req() req: { actor: { id: string; role: string; scopes: string[] } }) {
    return reconciliation(getPool(), req.actor);
  }

  @Public()
  @Post("v1/webhooks/payments/razorpay")
  async razorpay(@Body() body: unknown, @Headers() headers: Record<string, unknown>, @Req() req: { rawBody?: Buffer }) {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) throw new ApiError("PROVIDER_UNAVAILABLE", "Razorpay webhook not configured", { status: 502 });
    const sig = (headers["x-razorpay-signature"] ?? headers["X-Razorpay-Signature"]) as string | undefined;
    const { verifyRazorpaySignature, applyRazorpayEvent } = await import("../../../../modules/billing/src/billing");
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body ?? {}));
    if (!sig || !verifyRazorpaySignature(raw, sig, secret)) throw new ApiError("FORBIDDEN", "Bad webhook signature", { status: 403 });
    const evt = body as { id?: string; event?: string; payload?: { payment?: { entity?: { id: string; order_id?: string; amount?: number; status?: string } } } };
    const entity = evt.payload?.payment?.entity;
    if (!entity) throw new ApiError("INVALID_INPUT", "Unsupported webhook payload", { status: 400 });
    return applyRazorpayEvent(getPool(), evt.id ?? `${Date.now()}`, evt.event ?? "payment.captured", entity);
  }

  @Public()
  @Post("v1/webhooks/logistics/:provider")
  async logistics(@Param("provider") provider: string, @Body() body: unknown) {
    if (provider !== "manual") throw new ApiError("PROVIDER_UNAVAILABLE", `Provider ${provider} not configured`, { status: 502 });
    void body;
    // Manual handovers use authenticated, assigned job commands. There is no
    // provider signature to verify here, so an anonymous manual callback can
    // never be an authoritative delivery/custody event.
    throw new ApiError("FORBIDDEN", "Manual logistics has no public webhook", { status: 403 });
  }
}
