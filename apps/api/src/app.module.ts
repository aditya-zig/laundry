import { Module, Controller, Get, Post, Body, Req, UseGuards, Header, HttpCode } from "@nestjs/common";
import { z } from "zod";
import { AuthController } from "./controllers/auth.controller";
import { CatalogController } from "./controllers/catalog.controller";
import { OrdersController } from "./controllers/orders.controller";
import { OpsController } from "./controllers/ops.controller";
import { PartnerController } from "./controllers/partner.controller";
import { BillingController } from "./controllers/billing.controller";
import { ConversationController } from "./controllers/conversation.controller";
import { Public, AuthGuard } from "./guards/auth.guard";
import { PilotController } from "./controllers/pilot.controller";
import { DatabaseLifecycle } from "./database-lifecycle";
import { IdentityModule } from "./features/identity/identity.module";
import { CatalogModule } from "./features/catalog/catalog.module";
import { AvailabilityModule } from "./features/availability/availability.module";
import { identityFromEnvironment, type IdentityService } from "../../../modules/identity/src";
import { CatalogService } from "../../../modules/catalog/src";
import { AvailabilityService } from "../../../modules/availability/src";
import { getPool } from "../../../modules/shared/src/db";
import { demoMode } from "../../../modules/shared/src/auth";

@Controller()
class MiscController {
  @Public()
  @Get("v1/health")
  @Header('Cache-Control', 'no-store')
  health() {
    return { ok: true, service: "laundry-api", demoMode: demoMode(), productionReady: false };
  }

  @Public()
  @Get("health")
  @Header('Cache-Control', 'no-store')
  rootHealth() {
    return { ok: true, service: "laundry-api", productionReady: false };
  }

  @Public()
  @Get('health/ready')
  @HttpCode(503)
  @Header('Cache-Control', 'no-store')
  readiness() {
    return { service: 'laundry-api', productionReady: false, productApiEnabled: false, code: 'PRODUCTION_NOT_ENABLED' };
  }

  @Post("v1/media/upload-intents")
  @UseGuards(AuthGuard)
  async uploadIntent(@Req() _req: unknown, @Body() body: unknown) {
    void _req;
    const parsed = z.object({ mime: z.string().min(1), sizeBytes: z.number().int().positive().max(10_000_000) }).parse(body);
    return { uploadId: crypto.randomUUID(), mime: parsed.mime, note: "demo intent; upload to object storage before launch" };
  }
}

// One identity instance serves both feature modules. Creating it per module
// would build duplicate providers and split the configured delivery budget.
let identity: IdentityService | null | undefined;
function identityService(): IdentityService | null {
  if (identity === undefined) identity = identityFromEnvironment(getPool());
  return identity;
}

@Module({ imports: [
  IdentityModule.register(identityService),
  CatalogModule.register(() => {
    const service = identityService();
    return new CatalogService({ db: getPool(), authenticate: service ? token => service.authenticate(token) : undefined });
  }),
  AvailabilityModule.register(() => {
    const service = identityService();
    return new AvailabilityService({ db: getPool(), authenticate: service ? token => service.authenticate(token) : undefined });
  }),
], controllers: [MiscController, AuthController, CatalogController, OrdersController, OpsController, PartnerController, BillingController, ConversationController, PilotController], providers: [DatabaseLifecycle] })
export class AppModule {}
