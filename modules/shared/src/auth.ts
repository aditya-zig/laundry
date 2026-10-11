import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { ApiError } from "./errors";

export interface Actor { id: string; role: string; scopes: string[] }

export function demoMode(): boolean {
  return (process.env.DEMO_MODE ?? "true") !== "false";
}

export function demoOtpCode(): string {
  return process.env.DEMO_OTP_CODE ?? "000000";
}

export async function requestOtp(db: Pool, phone: string): Promise<{ challengeId: string; demoCode?: string }> {
  const code = demoMode() ? demoOtpCode() : String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const row = await db.query(`INSERT INTO otp_challenges (phone, code, expires_at) VALUES ($1,$2,$3) RETURNING id`, [phone, code, expiresAt]);
  return demoMode()
    ? { challengeId: row.rows[0].id as string, demoCode: code }
    : { challengeId: row.rows[0].id as string };
}

export async function verifyOtp(db: Pool, challengeId: string, code: string): Promise<{ token: string; user: { id: string; role: string; name: string; phone: string } }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(`SELECT * FROM otp_challenges WHERE id = $1 FOR UPDATE`, [challengeId]);
    if (cur.rowCount === 0) throw new ApiError("NOT_FOUND", "OTP challenge not found", { status: 404 });
    const ch = cur.rows[0];
    if (ch.consumed) throw new ApiError("INVALID_INPUT", "Challenge already used", { status: 400 });
    if (new Date(ch.expires_at).getTime() < Date.now()) throw new ApiError("INVALID_INPUT", "OTP expired", { status: 400 });
    if (Number(ch.attempts) >= 5) throw new ApiError("RATE_LIMITED", "Too many OTP attempts", { status: 429 });
    if (ch.code !== code) {
      await client.query(`UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1`, [challengeId]);
      await client.query("COMMIT");
      throw new ApiError("INVALID_INPUT", "Invalid OTP code", { status: 400 });
    }
    await client.query(`UPDATE otp_challenges SET consumed = TRUE WHERE id = $1`, [challengeId]);
    let user = (await client.query(`SELECT * FROM users WHERE phone = $1`, [ch.phone])).rows[0];
    if (!user) {
      if (!demoMode()) {
        await client.query("ROLLBACK");
        throw new ApiError("NOT_FOUND", "No account for this phone", { status: 404 });
      }
      const id = randomUUID();
      user = (await client.query(`INSERT INTO users (id, role, name, phone) VALUES ($1,'customer','Demo Customer',$2) RETURNING *`, [id, ch.phone])).rows[0];
    }
    const token = `sess_${randomUUID().replace(/-/g, "")}`;
    await client.query(`INSERT INTO sessions (token, user_id) VALUES ($1,$2)`, [token, user.id]);
    await client.query("COMMIT");
    return { token, user: { id: user.id as string, role: user.role as string, name: user.name as string, phone: user.phone as string } };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* already settled */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function demoAuth(db: Pool, role: "customer" | "rider" | "operator"): Promise<{ token: string; user: { id: string; role: string; name: string; phone: string } }> {
  if (!demoMode()) throw new ApiError("FORBIDDEN", "Demo auth disabled in real mode", { status: 403 });
  const map: Record<string, string> = {
    customer: process.env.DEMO_CUSTOMER_PHONE ?? "+91-90000-00001",
    rider: process.env.DEMO_RIDER_PHONE ?? "+91-90000-00002",
    operator: process.env.DEMO_OPERATOR_PHONE ?? "+91-90000-00003",
  };
  const phone = map[role];
  const user = (await db.query(`SELECT * FROM users WHERE phone = $1`, [phone])).rows[0];
  if (!user) throw new ApiError("NOT_FOUND", "Demo seed user missing; restart API to seed", { status: 404 });
  const token = `sess_${randomUUID().replace(/-/g, "")}`;
  await db.query(`INSERT INTO sessions (token, user_id) VALUES ($1,$2)`, [token, user.id]);
  return { token, user: { id: user.id as string, role: user.role as string, name: user.name as string, phone: user.phone as string } };
}

export async function actorFromToken(db: Pool, token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const row = (await db.query(
    `SELECT u.id, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`, [token])).rows[0];
  if (!row) return null;
  const scopes = row.role === "operator" || row.role === "admin"
    ? ["orders:read", "orders:write", "deliveries:manage", "catalog:manage", "support:manage"]
    : row.role === "rider" ? ["jobs:read", "jobs:write"]
    : row.role === "facility" ? ["orders:read", "orders:write"]
    : ["orders:read", "orders:write", "reviews:write"];
  return { id: row.id as string, role: row.role as string, scopes };
}

export async function logout(db: Pool, token: string): Promise<void> {
  await db.query(`DELETE FROM sessions WHERE token = $1`, [token]);
}
