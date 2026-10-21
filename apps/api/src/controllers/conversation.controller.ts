import { Controller, Get, Post, Param, Body, Req, Query, Res, UseGuards, Headers } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { getPool } from "../../../../modules/shared/src/db";
import { postMessage, confirmDraft } from "../../../../modules/conversations/src/conversations";
import { transcribeAudio } from "../../../../modules/conversations/src/speech";
import { verifyWhatsappSignature, whatsappChallenge, retrieveWhatsappMedia } from "../../../../modules/conversations/src/whatsapp";
import { emitOutbox } from "../../../../modules/shared/src/idempotency";
import { conversationMessageSchema, draftConfirmSchema } from "@laundry/contracts";
import { AuthGuard, Public } from "../guards/auth.guard";

type WaMessage = {
  id: string; type: string; from?: string; timestamp?: string;
  text?: { body: string }; audio?: { id: string; mime_type?: string; voice?: boolean };
};

async function enqueueWhatsappReply(to: string, body: string, draftId: string): Promise<void> {
  // Durable outbox: the worker owns the actual transport. HTTP ack never claims delivery.
  const db = getPool();
  await emitOutbox(db, draftId, "notification.whatsapp.v1", { to, body: body.slice(0, 4000), draftId });
}

@Controller()
export class ConversationController {
  @Post("v1/demo/conversations/messages")
  @UseGuards(AuthGuard)
  async demoMessage(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Body() body: unknown, @Headers() headers: Record<string, unknown>) {
    if (req.actor.role !== "customer") {
      const { ApiError } = await import("../../../../modules/shared/src/errors");
      throw new ApiError("FORBIDDEN", "Only customers draft orders", { status: 403 });
    }
    const parsed = conversationMessageSchema.parse(body);
    const key = headers["idempotency-key"] as string | undefined;
    return postMessage(getPool(), req.actor, parsed.text, {
      receivedAt: parsed.receivedAt, draftId: parsed.draftId,
      idempotencyKey: Array.isArray(key) ? key[0] : key,
    });
  }

  @Post("v1/conversation-drafts/:id/confirm")
  @UseGuards(AuthGuard)
  async confirm(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Param("id") id: string, @Body() body: unknown, @Headers() headers: Record<string, unknown>) {
    const parsed = draftConfirmSchema.parse({ ...(body as object), draftId: id });
    const key = headers["idempotency-key"] as string | undefined;
    return confirmDraft(getPool(), req.actor, id, parsed.revision, parsed.quoteId, { idempotencyKey: Array.isArray(key) ? key[0] : key });
  }

  @Public()
  @Get("v1/webhooks/whatsapp")
  async verify(@Query() q: { [k: string]: string }, @Res() res: Response) {
    const challenge = whatsappChallenge(q["hub.mode"], q["hub.verify_token"], q["hub.challenge"]);
    if (!challenge) return res.status(403).json({ code: "FORBIDDEN", message: "Bad verify token", traceId: "trace-wa", retryable: false });
    return res.status(200).send(challenge);
  }

  @Public()
  @Post("v1/webhooks/whatsapp")
  async inbound(@Body() body: unknown, @Headers() headers: Record<string, unknown>, @Req() req: { rawBody?: Buffer }) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body ?? {}));
    const sig = (headers["x-hub-signature-256"] ?? headers["X-Hub-Signature-256"]) as string | undefined;
    if (!verifyWhatsappSignature(raw, sig)) {
      const { ApiError } = await import("../../../../modules/shared/src/errors");
      throw new ApiError("FORBIDDEN", "Bad WhatsApp signature", { status: 403 });
    }
    const evt = body as { entry?: { changes?: { value?: { messages?: WaMessage[] } }[] }[] };
    const msg = evt.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return { accepted: true };
    const from = msg.from ?? "unknown";
    const conversationKey = `wa:${from}`;
    // Receipt timestamp from the provider (seconds) is the interpretation
    // clock for relative times like "tomorrow"; fall back to server time.
    const receivedAt = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString();
    if (msg.type === "audio" && msg.audio?.id) {
      let text: string;
      let uncertain: string[] = [];
      try {
        const media = await retrieveWhatsappMedia(msg.audio.id);
        const result = await transcribeAudio({ bytes: media.bytes, mime: media.mime });
        if (!result.ok) {
          const out = (await postMessage(getPool(), null, "voice note needs text fallback", {
            providerMessageId: msg.id, conversationKey, receivedAt,
          })) as Record<string, unknown>;
          if (String(out.reply ?? "").startsWith("Already handled")) return { accepted: true, ...out, transcriptUnavailable: result.reason };
          const reply = String((out.reply as string) ?? result.fallback);
          await enqueueWhatsappReply(from, reply, String((out.draft as { draftId: string }).draftId));
          return { accepted: true, ...out, transcriptUnavailable: result.reason };
        }
        text = result.text;
        uncertain = result.uncertainSpans;
      } catch (e) {
        const out = (await postMessage(getPool(), null, "voice note needs text fallback", {
          providerMessageId: msg.id, conversationKey, receivedAt,
        })) as Record<string, unknown>;
        if (String(out.reply ?? "").startsWith("Already handled")) return { accepted: true, ...out };
        const reply = `Voice note could not be fetched/transcribed (${(e as Error).message}). Type service, count, pickup time, address.`;
        await enqueueWhatsappReply(from, reply, String((out.draft as { draftId: string }).draftId));
        return { accepted: true, ...out, transcriptUnavailable: (e as Error).message };
      }
      const out = (await postMessage(getPool(), null, text.slice(0, 1000), {
        providerMessageId: msg.id, conversationKey, receivedAt, uncertainSpans: uncertain,
      })) as Record<string, unknown>;
      if (String(out.reply ?? "").startsWith("Already handled")) return { accepted: true, ...out, transcript: text.slice(0, 500) };
      await enqueueWhatsappReply(from, String(out.reply), String((out.draft as { draftId: string }).draftId));
      return { accepted: true, ...out, transcript: text.slice(0, 500) };
    }
    if (msg.type === "text" && msg.text?.body) {
      // Webhook path has no OTP session: private channel-scoped draft only.
      // Address linking needs explicit OTP-verified account linking (never auto-linked).
      const out = (await postMessage(getPool(), null, msg.text.body.slice(0, 1000), {
        providerMessageId: msg.id, conversationKey, receivedAt,
      })) as Record<string, unknown>;
      if (String(out.reply ?? "").startsWith("Already handled")) return { accepted: true, ...out };
      await enqueueWhatsappReply(from, String(out.reply), String((out.draft as { draftId: string }).draftId));
      return { accepted: true, ...out };
    }
    return { accepted: true };
  }

  @Post("v1/demo/conversations/voice-notes")
  @UseGuards(AuthGuard)
  async voice(@Req() req: { actor: { id: string; role: string; scopes: string[] } }, @Body() body: unknown) {
    if (req.actor.role !== "customer") {
      const { ApiError } = await import("../../../../modules/shared/src/errors");
      throw new ApiError("FORBIDDEN", "Only customers draft orders", { status: 403 });
    }
    const parsed = z.object({ mime: z.string().min(1), base64: z.string().min(1).max(14_000_000) }).parse(body);
    const bytes = Buffer.from(parsed.base64, "base64");
    const result = await transcribeAudio({ bytes, mime: parsed.mime });
    if (!result.ok) return { ok: false, reason: result.reason, fallback: result.fallback, booked: false };
    const out = (await postMessage(getPool(), req.actor, result.text, { uncertainSpans: result.uncertainSpans })) as Record<string, unknown>;
    return { ok: true, transcript: result.text, detectedLanguage: result.detectedLanguage, uncertainSpans: result.uncertainSpans, booked: false, ...out };
  }

  @Get("v1/ops/conversations")
  @UseGuards(AuthGuard)
  async opsList(@Req() req: { actor: { role: string } }) {
    if (req.actor.role !== "operator" && req.actor.role !== "admin") {
      const { ApiError } = await import("../../../../modules/shared/src/errors");
      throw new ApiError("FORBIDDEN", "Ops only", { status: 403 });
    }
    const rows = (await getPool().query(`SELECT * FROM conversation_drafts ORDER BY updated_at DESC LIMIT 50`)).rows;
    return rows;
  }

  @Post("v1/ops/conversations/:id/handoff")
  @UseGuards(AuthGuard)
  async handoff(@Req() req: { actor: { role: string } }, @Param("id") id: string) {
    if (req.actor.role !== "operator" && req.actor.role !== "admin") {
      const { ApiError } = await import("../../../../modules/shared/src/errors");
      throw new ApiError("FORBIDDEN", "Ops only", { status: 403 });
    }
    await getPool().query(`UPDATE conversation_drafts SET state = 'HUMAN_HANDOFF' WHERE id = $1`, [id]);
    return { id, state: "HUMAN_HANDOFF" };
  }
}
