import { Module, Controller, Get, Post, Body, Req, UseGuards, Header, HttpCode } from "@nestjs/common";
import { z } from "zod";
import { completeReturnWhenSettled } from '../../../modules/orders/src/completion';
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
import { OrdersModule } from "./features/orders/orders.module";
import { identityFromEnvironment, type IdentityService } from "../../../modules/identity/src";
import { CatalogService } from "../../../modules/catalog/src";
import { AvailabilityService } from "../../../modules/availability/src";
import { OrdersFault, OrdersService } from "../../../modules/orders/src";
import { getPool } from "../../../modules/shared/src/db";
import { demoMode } from "../../../modules/shared/src/auth";
import { ProductModule } from './features/product.module';
import { BillingService, BillingFault, createObligationForOrder, reconcileObligationForReturn } from '../../../modules/billing/src';
import { LogisticsFault, LogisticsService } from '../../../modules/logistics/src';
import { SupportService } from '../../../modules/support/src';
import { ReviewsService } from '../../../modules/reviews/src';
import { JobsService } from '../../../modules/jobs/src';

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

function authenticate() {
  const service = identityService();
  return service ? (token: string) => service.authenticate(token) : undefined;
}
let catalog: CatalogService | undefined;
function catalogService(): CatalogService {
  return (catalog ??= new CatalogService({ db: getPool(), authenticate: authenticate() }));
}
let availability: AvailabilityService | undefined;
function availabilityService(): AvailabilityService {
  return (availability ??= new AvailabilityService({ db: getPool(), authenticate: authenticate() }));
}
let orders: OrdersService | undefined;
function ordersService(): OrdersService {
  return (orders ??= new OrdersService({ db: getPool(), authenticate: authenticate(), catalog: catalogService(), availability: availabilityService(),
    onBooked: async (order, transaction) => {
      await createObligationForOrder(transaction, { orderId: order.id });
      await logisticsService().openLegAttempt(order.id, 'PICKUP', { scheduledWindow: order.pickupWindow }, transaction);
    },
    onReady: async (order, transaction) => {
      try {
        const obligation = await reconcileObligationForReturn(transaction, { orderId: order.id });
        await logisticsService().openLegAttempt(order.id, 'RETURN', { scheduledWindow: order.promisedReturnWindow }, transaction);
        return obligation;
      } catch (error) {
        if (error instanceof BillingFault || error instanceof LogisticsFault) throw new OrdersFault(error.code, error.message);
        throw error;
      }
    },
  }));
}

let logistics: LogisticsService | undefined;
function logisticsService(): LogisticsService {
  // Tracking/custody reads and transactional leg creation do not require a
  // dispatch provider. Assignment refuses missing custody-code delivery.
  return (logistics ??= new LogisticsService({ db: getPool(), authenticate: authenticate(),
    onReturnAccepted: (id, tx, context) => completeReturnWhenSettled(tx, id, context),
  }));
}
let billing: BillingService | undefined;
function billingService(): BillingService {
  return (billing ??= new BillingService({ db: getPool(), authenticate: authenticate(),
    onSettled: (id, tx, context) => completeReturnWhenSettled(tx, id, context), provider: {
    async refund() { throw new BillingFault('PROVIDER_UNAVAILABLE', 'A live refund provider is not configured'); },
  } }));
}
let support: SupportService | undefined;
function supportService(): SupportService {
  return (support ??= new SupportService({ db: getPool(), authenticate: authenticate() }));
}
let reviews: ReviewsService | undefined;
function reviewsService(): ReviewsService {
  return (reviews ??= new ReviewsService({ db: getPool(), authenticate: authenticate() }));
}
let jobs: JobsService | undefined;
function jobsService(): JobsService {
  return (jobs ??= new JobsService({ db: getPool(), authenticate: authenticate() }));
}

@Module({ imports: [
  ProductModule.register({ billing: billingService, logistics: logisticsService, support: supportService, reviews: reviewsService, jobs: jobsService }),
  IdentityModule.register(identityService),
  CatalogModule.register(catalogService),
  AvailabilityModule.register(availabilityService),
  OrdersModule.register(ordersService),
], controllers: [MiscController, AuthController, CatalogController, OrdersController, OpsController, PartnerController, BillingController, ConversationController, PilotController], providers: [DatabaseLifecycle] })
export class AppModule {}
