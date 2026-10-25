import { ArgumentsHost, Body, Catch, Controller, DynamicModule, ExceptionFilter, Get, Headers, HttpCode, Inject, Module, Param, Post, Res, UseFilters } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { v2 } from '@laundry/contracts';
import { ApiError } from '../../../../../modules/shared/src/errors';
import { LogisticsFault, LogisticsService } from '../../../../../modules/logistics/src';

const LOGISTICS = Symbol('laundry.logistics-v2');

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
    throw new LogisticsFault('UNAUTHENTICATED', 'Sign in again to continue');
  }
  return header.slice(7);
}

function idempotency(key: string | undefined): string {
  if (key === undefined || key.trim().length === 0) {
    throw new LogisticsFault('INVALID_INPUT', 'An Idempotency-Key header is required');
  }
  return key;
}

@Catch()
export class LogisticsEnvelopeFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    noStore(response);
    const traceId = randomUUID();
    if (error instanceof LogisticsFault) {
      return response.status(v2.errorHttpStatus[error.code]).json(v2.errorEnvelopeSchema.parse({
        code: error.code,
        message: error.message,
        traceId,
        retryable: v2.errorRetryable[error.code],
        ...(error.currentVersion === undefined ? {} : { currentVersion: error.currentVersion }),
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
    console.error('[logistics]', { traceId, code: 'INTERNAL_FAILURE' });
    return response.status(503).json({
      code: 'PROVIDER_UNAVAILABLE', message: 'Logistics is temporarily unavailable', traceId, retryable: true,
    });
  }
}

@Controller('v2/rider')
@UseFilters(LogisticsEnvelopeFilter)
export class RiderV2Controller {
  constructor(@Inject(LOGISTICS) private readonly service: LogisticsService | null) {}
  private get logistics(): LogisticsService {
    if (!this.service) throw new LogisticsFault('PROVIDER_UNAVAILABLE', 'Logistics is not configured');
    return this.service;
  }

  @Get('jobs')
  jobs(@Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.logistics.listRiderJobs(bearer(authorization));
  }

  @Get('jobs/:jobId')
  job(@Param('jobId') jobId: string, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.logistics.getRiderJob(bearer(authorization), jobId);
  }

  @Post('jobs/:jobId/accept')
  @HttpCode(200)
  accept(
    @Param('jobId') jobId: string,
    @Body() input: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.logistics.acceptJob(bearer(authorization), jobId, v2.versionedCommandSchema.parse(input), idempotency(key));
  }

  @Post('handovers')
  @HttpCode(200)
  handover(
    @Body() input: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.logistics.recordHandover(bearer(authorization), v2.riderHandoverSchema.parse(input), idempotency(key));
  }

  @Post('jobs/:jobId/exception')
  @HttpCode(200)
  exception(
    @Param('jobId') jobId: string,
    @Body() input: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.logistics.reportException(bearer(authorization), jobId, v2.deliveryExceptionSchema.parse(input), idempotency(key));
  }

  @Post('location')
  @HttpCode(200)
  location(
    @Body() input: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.logistics.reportLocation(bearer(authorization), v2.riderLocationReportSchema.parse(input), idempotency(key));
  }
}

@Controller('v2/ops/logistics')
@UseFilters(LogisticsEnvelopeFilter)
export class OpsLogisticsV2Controller {
  constructor(@Inject(LOGISTICS) private readonly service: LogisticsService | null) {}
  private get logistics(): LogisticsService {
    if (!this.service) throw new LogisticsFault('PROVIDER_UNAVAILABLE', 'Logistics is not configured');
    return this.service;
  }

  @Post('assignments')
  @HttpCode(200)
  assign(
    @Body() input: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.logistics.assign(bearer(authorization), v2.assignmentInputSchema.parse(input), idempotency(key));
  }

  @Post('assignments/:assignmentId/reassign')
  @HttpCode(200)
  reassign(
    @Param('assignmentId') assignmentId: string,
    @Body() input: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.logistics.reassign(bearer(authorization), assignmentId, v2.reassignmentInputSchema.parse(input), idempotency(key));
  }

  @Post('legs/:legAttemptId/cancel')
  @HttpCode(200)
  cancel(
    @Param('legAttemptId') legAttemptId: string,
    @Body() input: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.logistics.cancelLeg(bearer(authorization), legAttemptId, v2.legCancellationSchema.parse(input), idempotency(key));
  }
}

@Controller('v2/webhooks/logistics')
@UseFilters(LogisticsEnvelopeFilter)
export class LogisticsWebhookV2Controller {
  constructor(@Inject(LOGISTICS) private readonly service: LogisticsService | null) {}
  private get logistics(): LogisticsService {
    if (!this.service) throw new LogisticsFault('PROVIDER_UNAVAILABLE', 'Logistics is not configured');
    return this.service;
  }

  @Post(':provider')
  @HttpCode(200)
  receive(
    @Param('provider') provider: string,
    @Body() input: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.logistics.handleProviderEvent(provider, input, headers);
  }
}

@Controller('v2')
@UseFilters(LogisticsEnvelopeFilter)
export class TrackingV2Controller {
  constructor(@Inject(LOGISTICS) private readonly service: LogisticsService | null) {}
  private get logistics(): LogisticsService {
    if (!this.service) throw new LogisticsFault('PROVIDER_UNAVAILABLE', 'Logistics is not configured');
    return this.service;
  }

  @Get('orders/:orderId/tracking')
  tracking(@Param('orderId') orderId: string, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.logistics.getTracking(bearer(authorization), orderId);
  }

  @Get('logistics/tracking/:orderId')
  trackingRead(@Param('orderId') orderId: string, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.logistics.getTracking(bearer(authorization), orderId);
  }

  @Get('orders/:orderId/custody-receipt')
  custodyReceipt(@Param('orderId') orderId: string, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.logistics.getCustodyReceipt(bearer(authorization), orderId);
  }
}

@Module({})
export class LogisticsV2Module {
  static register(factory: () => LogisticsService | null): DynamicModule {
    return {
      module: LogisticsV2Module,
      controllers: [RiderV2Controller, OpsLogisticsV2Controller, LogisticsWebhookV2Controller, TrackingV2Controller],
      providers: [{ provide: LOGISTICS, useFactory: factory }],
    };
  }
}
