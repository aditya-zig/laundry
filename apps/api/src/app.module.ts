import { Module, Controller, Get, Post, Body, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthController } from "./controllers/auth.controller";
import { CatalogController } from "./controllers/catalog.controller";
import { OrdersController } from "./controllers/orders.controller";
import { OpsController } from "./controllers/ops.controller";
import { PartnerController } from "./controllers/partner.controller";
import { BillingController } from "./controllers/billing.controller";
import { ConversationController } from "./controllers/conversation.controller";
import { Public, AuthGuard } from "./guards/auth.guard";

@Controller()
class MiscController {
  @Public()
  @Get("v1/health")
  health() {
    return { ok: true, service: "laundry-api", demoMode: (process.env.DEMO_MODE ?? "true") !== "false" };
  }

  @Public()
  @Get("health")
  rootHealth() {
    return { ok: true, service: "laundry-api" };
  }

  @Post("v1/media/upload-intents")
  @UseGuards(AuthGuard)
  async uploadIntent(@Req() _req: unknown, @Body() body: unknown) {
    void _req;
    const parsed = z.object({ mime: z.string().min(1), sizeBytes: z.number().int().positive().max(10_000_000) }).parse(body);
    return { uploadId: crypto.randomUUID(), mime: parsed.mime, note: "demo intent; upload to object storage before launch" };
  }
}

@Module({ controllers: [MiscController, AuthController, CatalogController, OrdersController, OpsController, PartnerController, BillingController, ConversationController] })
export class AppModule {}
