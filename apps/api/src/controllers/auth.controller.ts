import { Controller, Get, Post, Patch, Delete, Param, Body, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { getPool } from "../../../../modules/shared/src/db";
import { requestOtp, verifyOtp, demoAuth, logout } from "../../../../modules/shared/src/auth";
import { otpRequestSchema, otpVerifySchema, demoAuthSchema } from "@wandary/contracts";
import { AuthGuard, Public } from "../guards/auth.guard";

@Controller()
export class AuthController {
  @Public()
  @Post("v1/auth/otp/request")
  async request(@Body() body: unknown) {
    const { phone } = otpRequestSchema.parse(body);
    return requestOtp(getPool(), phone);
  }

  @Public()
  @Post("v1/auth/otp/verify")
  async verify(@Body() body: unknown) {
    const { challengeId, code } = otpVerifySchema.parse(body);
    return verifyOtp(getPool(), challengeId, code);
  }

  @Public()
  @Post("v1/auth/demo")
  async demo(@Body() body: unknown) {
    const { role } = demoAuthSchema.parse(body);
    return demoAuth(getPool(), role);
  }

  @Post("v1/auth/logout")
  @UseGuards(AuthGuard)
  async logout(@Req() req: { token: string }) {
    await logout(getPool(), req.token);
    return { ok: true };
  }

  @Get("v1/me")
  @UseGuards(AuthGuard)
  async me(@Req() req: { actor: { id: string; role: string } }) {
    const row = (await getPool().query(`SELECT id, role, name, phone FROM users WHERE id = $1`, [req.actor.id])).rows[0];
    return row;
  }

  @Get("v1/addresses")
  @UseGuards(AuthGuard)
  async list(@Req() req: { actor: { id: string } }) {
    const rows = (await getPool().query(`SELECT id, version, owner_id AS "ownerId", label, line1, city, postal_code AS "postalCode" FROM addresses WHERE owner_id = $1 AND deleted = FALSE`, [req.actor.id])).rows;
    return rows;
  }

  @Post("v1/addresses")
  @UseGuards(AuthGuard)
  async create(@Req() req: { actor: { id: string } }, @Body() body: unknown) {
    const parsed = z.object({ label: z.string().min(1), line1: z.string().min(1), city: z.string().min(1), postalCode: z.string().min(1) }).parse(body);
    const row = (await getPool().query(
      `INSERT INTO addresses (owner_id, label, line1, city, postal_code) VALUES ($1,$2,$3,$4,$5) RETURNING id, version, owner_id AS "ownerId", label, line1, city, postal_code AS "postalCode"`,
      [req.actor.id, parsed.label, parsed.line1, parsed.city, parsed.postalCode])).rows[0];
    return row;
  }

  @Patch("v1/addresses/:id")
  @UseGuards(AuthGuard)
  async patch(@Req() req: { actor: { id: string } }, @Param("id") id: string, @Body() body: unknown) {
    const parsed = z.object({ label: z.string().min(1).optional(), line1: z.string().min(1).optional(), city: z.string().min(1).optional(), postalCode: z.string().min(1).optional(), expectedVersion: z.number().int().min(1) }).parse(body);
    const own = (await getPool().query(`SELECT * FROM addresses WHERE id = $1 AND owner_id = $2 AND deleted = FALSE`, [id, req.actor.id])).rows[0];
    if (!own) {
      const { ApiError } = await import("../../../../modules/shared/src/errors");
      throw new ApiError("NOT_FOUND", "Address not found", { status: 404 });
    }
    if (Number(own.version) !== parsed.expectedVersion) {
      const { ApiError } = await import("../../../../modules/shared/src/errors");
      throw new ApiError("VERSION_CONFLICT", "Stale address version", { status: 409 });
    }
    const row = (await getPool().query(
      `UPDATE addresses SET label = COALESCE($1,label), line1 = COALESCE($2,line1), city = COALESCE($3,city), postal_code = COALESCE($4,postal_code), version = version + 1 WHERE id = $5 RETURNING id, version, owner_id AS "ownerId", label, line1, city, postal_code AS "postalCode"`,
      [parsed.label ?? null, parsed.line1 ?? null, parsed.city ?? null, parsed.postalCode ?? null, id])).rows[0];
    return row;
  }

  @Delete("v1/addresses/:id")
  @UseGuards(AuthGuard)
  async remove(@Req() req: { actor: { id: string } }, @Param("id") id: string) {
    const own = (await getPool().query(`SELECT * FROM addresses WHERE id = $1 AND owner_id = $2 AND deleted = FALSE`, [id, req.actor.id])).rows[0];
    if (!own) {
      const { ApiError } = await import("../../../../modules/shared/src/errors");
      throw new ApiError("NOT_FOUND", "Address not found", { status: 404 });
    }
    await getPool().query(`UPDATE addresses SET deleted = TRUE WHERE id = $1`, [id]);
    return { ok: true };
  }

  @Post("v1/account-links/whatsapp")
  @UseGuards(AuthGuard)
  async link(@Req() req: { actor: { id: string; role: string } }, @Body() body: unknown) {
    // Explicit OTP-verified linking: the customer proves phone ownership via
    // their session, then claims the channel-scoped drafts for that sender.
    // Never auto-links on an unverified "my number is X" claim.
    if (req.actor.role !== "customer") {
      const { ApiError } = await import("../../../../modules/shared/src/errors");
      throw new ApiError("FORBIDDEN", "Only customers link WhatsApp", { status: 403 });
    }
    const parsed = z.object({ senderPhone: z.string().min(6).max(20) }).parse(body);
    const sender = parsed.senderPhone.replace(/[^\d]/g, "");
    if (sender.length < 6) {
      const { ApiError } = await import("../../../../modules/shared/src/errors");
      throw new ApiError("INVALID_INPUT", "senderPhone is not a phone number", { status: 400 });
    }
    const key = `wa:${parsed.senderPhone}`;
    const altKey = `wa:${sender}`;
    const res = await getPool().query(
      `UPDATE conversation_drafts SET customer_id = $1, updated_at = now()
        WHERE conversation_key IN ($2,$3) AND (customer_id IS NULL OR customer_id = $1)`,
      [req.actor.id, key, altKey],
    );
    return { ok: true, linkedDrafts: res.rowCount ?? 0, note: "Channel drafts linked to this OTP-verified account; confirmations still require bound draft/revision/quote." };
  }
}
