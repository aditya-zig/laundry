import { ArgumentsHost, Body, Catch, Controller, DynamicModule, ExceptionFilter, Get, Headers, HttpCode, Inject, Module, Param, Post, Query, Res, UseFilters } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { v2 } from '@laundry/contracts';
import { ApiError } from '../../../../../modules/shared/src/errors';
import { OrdersFault, OrdersService } from '../../../../../modules/orders/src';

const ORDERS = Symbol('laundry.orders');

interface Response {
  setHeader(name: string, value: string): unknown;
  status(code: number): Response;
  json(body: unknown): unknown;
}

function noStore(response: Response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function bearer(header: string | undefined): string {
  if (!header || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) {
    throw new OrdersFault('UNAUTHENTICATED', 'Sign in again to continue');
  }
  return header.slice(7);
}

@Catch()
export class OrdersEnvelopeFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    noStore(response);
    const traceId = randomUUID();
    if (error instanceof OrdersFault) {
      return response.status(v2.errorHttpStatus[error.code]).json(v2.errorEnvelopeSchema.parse({
        code: error.code, message: error.message, traceId,
        retryable: v2.errorRetryable[error.code], currentVersion: error.currentVersion,
      }));
    }
    if (error instanceof ApiError) {
      return response.status(error.status).json({ ...error.toEnvelope(), traceId: error.traceId });
    }
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues.slice(0, 50)) (fieldErrors[issue.path.join('.') || 'body'] ??= []).push(issue.message);
      return response.status(400).json({ code: 'INVALID_INPUT', message: 'Request failed validation', traceId, retryable: false, fieldErrors });
    }
    console.error('[orders]', { traceId, code: 'INTERNAL_FAILURE' });
    return response.status(503).json({
      code: 'PROVIDER_UNAVAILABLE', message: 'Orders are temporarily unavailable', traceId, retryable: true,
    });
  }
}

interface PageQueryRaw {
  cursor?: string;
  limit?: string;
  status?: string;
}

function pageQuery(raw: PageQueryRaw) {
  return {
    ...(raw.cursor === undefined ? {} : { cursor: raw.cursor }),
    ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
    ...(raw.status === undefined ? {} : { status: raw.status }),
  };
}

@Controller('v2/orders')
@UseFilters(OrdersEnvelopeFilter)
export class OrdersController {
  constructor(@Inject(ORDERS) private readonly service: OrdersService | null) {}
  private get orders(): OrdersService {
    if (!this.service) throw new OrdersFault('PROVIDER_UNAVAILABLE', 'Orders are not configured');
    return this.service;
  }

  @Post('quotes')
  @HttpCode(200)
  quote(@Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.orders.createQuote(bearer(authorization), v2.quoteInputSchema.parse(input), key);
  }

  @Post()
  @HttpCode(200)
  book(@Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.orders.bookOrder(bearer(authorization), v2.bookingInputSchema.parse(input), key);
  }

  @Get()
  list(@Query() raw: PageQueryRaw, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.orders.listOrders(bearer(authorization), pageQuery(raw));
  }

  @Get(':orderId')
  detail(@Param('orderId') orderId: string, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.orders.getOrder(bearer(authorization), orderId);
  }

  @Get(':orderId/timeline')
  timeline(@Param('orderId') orderId: string, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.orders.getTimeline(bearer(authorization), orderId);
  }

  @Post(':orderId/cancel')
  @HttpCode(200)
  cancel(@Param('orderId') orderId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.orders.cancel(bearer(authorization), orderId, v2.orderCancellationSchema.parse(input), key);
  }

  @Post(':orderId/reschedule')
  @HttpCode(200)
  reschedule(@Param('orderId') orderId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.orders.reschedule(bearer(authorization), orderId, v2.orderRescheduleSchema.parse(input), key);
  }

  @Post(':orderId/adjustments/decision')
  @HttpCode(200)
  decide(@Param('orderId') orderId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.orders.decideAdjustment(bearer(authorization), orderId, v2.adjustmentDecisionSchema.parse(input), key);
  }
}

@Controller('v2/ops/orders')
@UseFilters(OrdersEnvelopeFilter)
export class OpsOrdersController {
  constructor(@Inject(ORDERS) private readonly service: OrdersService | null) {}
  private get orders(): OrdersService {
    if (!this.service) throw new OrdersFault('PROVIDER_UNAVAILABLE', 'Orders are not configured');
    return this.service;
  }

  @Get('queue')
  queue(@Query() raw: PageQueryRaw, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.orders.opsQueue(bearer(authorization), pageQuery(raw));
  }

  @Post(':orderId/intake')
  @HttpCode(200)
  intake(@Param('orderId') orderId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.orders.recordIntake(bearer(authorization), orderId, v2.intakeRecordSchema.parse(input), key);
  }

  @Post(':orderId/care')
  @HttpCode(200)
  care(@Param('orderId') orderId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.orders.recordCare(bearer(authorization), orderId, v2.careUpdateSchema.parse(input), key);
  }

  @Post(':orderId/quality-check')
  @HttpCode(200)
  qualityCheck(@Param('orderId') orderId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.orders.recordQualityCheck(bearer(authorization), orderId, v2.qualityCheckSchema.parse(input), key);
  }

  @Post(':orderId/hold')
  @HttpCode(200)
  hold(@Param('orderId') orderId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.orders.holdOrder(bearer(authorization), orderId, v2.orderHoldSchema.parse(input), key);
  }

  @Post(':orderId/exceptions/resolve')
  @HttpCode(200)
  exception(@Param('orderId') orderId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.orders.resolveException(bearer(authorization), orderId, v2.exceptionResolutionSchema.parse(input), key);
  }
}

@Module({})
export class OrdersModule {
  static register(factory: () => OrdersService | null): DynamicModule {
    return {
      module: OrdersModule,
      controllers: [OrdersController, OpsOrdersController],
      providers: [{ provide: ORDERS, useFactory: factory }],
    };
  }
}
