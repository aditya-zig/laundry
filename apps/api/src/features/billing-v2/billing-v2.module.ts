import { ArgumentsHost, Body, Catch, Controller, DynamicModule, ExceptionFilter, Get, Headers, HttpCode, Inject, Module, Param, Post, Query, Req, Res, UseFilters } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { v2 } from '@laundry/contracts';
import { ApiError } from '../../../../../modules/shared/src/errors';
import { BillingFault, BillingService } from '../../../../../modules/billing/src';

const BILLING = Symbol('laundry.billing');

interface Response {
  setHeader(name: string, value: string): unknown;
  status(code: number): Response;
  json(body: unknown): unknown;
}

interface RawRequest {
  rawBody?: Buffer;
  body?: unknown;
}

function noStore(response: Response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function bearer(header: string | undefined): string {
  if (!header || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) {
    throw new BillingFault('UNAUTHENTICATED', 'Sign in again to continue');
  }
  return header.slice(7);
}

@Catch()
export class BillingEnvelopeFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    noStore(response);
    const traceId = randomUUID();
    if (error instanceof BillingFault) {
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
    console.error('[billing]', { traceId, code: 'INTERNAL_FAILURE' });
    return response.status(503).json({
      code: 'PROVIDER_UNAVAILABLE', message: 'Billing is temporarily unavailable', traceId, retryable: true,
    });
  }
}

interface PageQueryRaw {
  cursor?: string;
  limit?: string;
}

function pageQuery(raw: PageQueryRaw) {
  return {
    ...(raw.cursor === undefined ? {} : { cursor: raw.cursor }),
    ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
  };
}

function serviceOf(service: BillingService | null): BillingService {
  if (!service) throw new BillingFault('PROVIDER_UNAVAILABLE', 'Billing is not configured');
  return service;
}

@Controller('v2')
@UseFilters(BillingEnvelopeFilter)
export class OrderBillingController {
  constructor(@Inject(BILLING) private readonly service: BillingService | null) {}

  @Get('orders/:orderId/billing/obligations')
  obligations(@Param('orderId') orderId: string, @Query() raw: PageQueryRaw, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).listOrderObligations(bearer(authorization), orderId, pageQuery(raw));
  }

  @Get('orders/:orderId/billing/attempts')
  attempts(@Param('orderId') orderId: string, @Query() raw: PageQueryRaw, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).listOrderAttempts(bearer(authorization), orderId, pageQuery(raw));
  }

  @Get('orders/:orderId/billing/receipts')
  receipts(@Param('orderId') orderId: string, @Query() raw: PageQueryRaw, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).listOrderReceipts(bearer(authorization), orderId, pageQuery(raw));
  }

  @Get('orders/:orderId/billing/refunds')
  refunds(@Param('orderId') orderId: string, @Query() raw: PageQueryRaw, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).listOrderRefunds(bearer(authorization), orderId, pageQuery(raw));
  }
}

@Controller('v2/billing')
@UseFilters(BillingEnvelopeFilter)
export class BillingReadController {
  constructor(@Inject(BILLING) private readonly service: BillingService | null) {}

  @Get('obligations')
  obligations(@Query() raw: PageQueryRaw, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).listObligations(bearer(authorization), pageQuery(raw));
  }

  @Get('obligations/:obligationId')
  obligation(@Param('obligationId') obligationId: string, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).getObligationSummary(bearer(authorization), obligationId);
  }

  @Get('obligations/:obligationId/receipts')
  receipts(@Param('obligationId') obligationId: string, @Query() raw: PageQueryRaw, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).listReceiptsForObligation(bearer(authorization), obligationId, pageQuery(raw));
  }

  @Get('refunds')
  refunds(@Query() raw: PageQueryRaw, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).listRefunds(bearer(authorization), pageQuery(raw));
  }
}

@Controller('v2/ops/billing')
@UseFilters(BillingEnvelopeFilter)
export class OpsBillingController {
  constructor(@Inject(BILLING) private readonly service: BillingService | null) {}

  @Post('obligations/:obligationId/confirm-manual')
  @HttpCode(200)
  confirmManual(@Param('obligationId') obligationId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).confirmManual(bearer(authorization), obligationId, v2.manualPaymentConfirmationSchema.parse(input), key);
  }

  @Post('refunds')
  @HttpCode(200)
  createRefund(@Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).requestRefund(bearer(authorization), v2.refundRequestSchema.parse(input), key);
  }

  @Post('reconciliation')
  @HttpCode(200)
  reconcile(@Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const parsed = v2.reconciliationRequestSchema.parse(input);
    return serviceOf(this.service).reconcile(bearer(authorization), parsed.period, key);
  }
}

@Controller('v2/webhooks/payments')
@UseFilters(BillingEnvelopeFilter)
export class PaymentWebhookController {
  constructor(@Inject(BILLING) private readonly service: BillingService | null) {}

  /**
   * The only provider route. A signature over the untouched request bytes is
   * verified before the service opens a transaction, so an unsigned body never
   * reaches a write. The app must preserve the untouched request body; missing
   * raw bytes fail closed rather than authenticating re-serialized JSON.
   */
  @Post(':provider')
  @HttpCode(200)
  webhook(@Param('provider') provider: string, @Body() body: unknown, @Headers('x-provider-signature') signature: string | undefined, @Req() request: RawRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    void body;
    if (!Buffer.isBuffer(request.rawBody)) throw new BillingFault('UNAUTHENTICATED', 'Untouched provider request bytes are required');
    return serviceOf(this.service).processWebhook(provider, request.rawBody, signature);
  }
}

@Module({})
export class BillingV2Module {
  static register(factory: () => BillingService | null): DynamicModule {
    return {
      module: BillingV2Module,
      controllers: [OrderBillingController, BillingReadController, OpsBillingController, PaymentWebhookController],
      providers: [{ provide: BILLING, useFactory: factory }],
    };
  }
}
