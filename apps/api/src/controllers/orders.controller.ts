import { Controller, Get, Post, Param, Body, Req, UseGuards, Headers } from "@nestjs/common";
import { z } from "zod";
import { getPool } from "../../../../modules/shared/src/db";
import { createQuote } from "../../../../modules/orders/src/quotes";
import { createCheckout, capturePayment, getOrder, listOrders, cancelOrder } from "../../../../modules/orders/src/orders";
import { decideAdjustment, rescheduleOrder } from "../../../../modules/orders/src/fulfillment";
import { createSupportIncident, getSupportIncident, postSupportMessage } from "../../../../modules/orders/src/support";
import { quoteInputSchema, cancelOrderSchema } from "@wandary/contracts";
import { AuthGuard } from "../guards/auth.guard";

function keyOf(headers: Record<string, unknown>): string | undefined {
  const v = (headers["idempotency-key"] ?? headers["Idempotency-Key"]) as string | undefined;
  return Array.isArray(v) ? v[0] : v;
}

@Controller()
@UseGuards(AuthGuard)
export class OrdersController {
  @Post("v1/quotes")
  async quote(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Body() body: unknown, @Headers() headers: Record<string, unknown>) {
    const parsed = quoteInputSchema.parse(body);
    return createQuote(getPool(), req.actor, parsed, { idempotencyKey: keyOf(headers) });
  }

  @Post("v1/checkouts")
  async checkout(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Body() body: unknown, @Headers() headers: Record<string, unknown>) {
    const parsed = z.object({ quoteId: z.string().uuid(), expectedVersion: z.number().int().min(1).optional() }).parse(body);
    return createCheckout(getPool(), req.actor, parsed.quoteId, parsed.expectedVersion, { idempotencyKey: keyOf(headers) });
  }

  @Get("v1/orders")
  async list(@Req() req: { actor: { id: string; role: string; scopes: string[] } }) {
    return listOrders(getPool(), req.actor);
  }

  @Get("v1/orders/:id")
  async one(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string) {
    return getOrder(getPool(), req.actor, id);
  }

  @Get("v1/orders/:id/timeline")
  async timeline(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string) {
    const order = (await getOrder(getPool(), req.actor, id)) as { timeline: unknown };
    return order.timeline;
  }

  @Post("v1/orders/:id/cancel")
  async cancel(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string, @Body() body: unknown) {
    const parsed = cancelOrderSchema.parse(body);
    return cancelOrder(getPool(), req.actor, id, parsed.reason, parsed.expectedVersion);
  }

  @Post("v1/orders/:id/reschedule")
  async reschedule(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string, @Body() body: unknown) {
    const parsed = z.object({ newQuoteId: z.string().uuid(), expectedVersion: z.number().int().min(1) }).parse(body);
    return rescheduleOrder(getPool(), req.actor, id, parsed.newQuoteId, parsed.expectedVersion);
  }

  @Post("v1/orders/:id/adjustments/:adjustmentId/decision")
  async decision(
    @Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string,
    @Param("adjustmentId") adjustmentId: string, @Body() body: unknown, @Headers() headers: Record<string, unknown>,
  ) {
    void headers;
    const parsed = z.object({ decision: z.enum(["ACCEPT", "DECLINE"]), expectedVersion: z.number().int().min(1).optional() }).parse(body);
    return decideAdjustment(getPool(), req.actor, id, adjustmentId, parsed.decision, parsed.expectedVersion);
  }

  @Post("v1/demo/payments/:id/capture")
  async capture(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string, @Headers() headers: Record<string, unknown>) {
    return capturePayment(getPool(), req.actor, id, { idempotencyKey: keyOf(headers) });
  }

  @Post("v1/orders/:id/support")
  async openSupport(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string, @Body() body: unknown) {
    const parsed = z.object({ message: z.string().min(1).max(2000) }).parse(body);
    return createSupportIncident(getPool(), req.actor, id, parsed.message);
  }

  @Get("v1/support/:id")
  async getSupport(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string) {
    return getSupportIncident(getPool(), req.actor, id);
  }

  @Post("v1/support/:id/messages")
  async postSupport(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string, @Body() body: unknown) {
    const parsed = z.object({ message: z.string().min(1).max(2000) }).parse(body);
    return postSupportMessage(getPool(), req.actor, id, parsed.message);
  }
}
