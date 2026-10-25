import { ArgumentsHost, Body, Catch, Controller, DynamicModule, ExceptionFilter, Get, Headers, HttpCode, Inject, Module, Param, Post, Query, Res, UseFilters } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { v2 } from '@laundry/contracts';
import { ApiError } from '../../../../../modules/shared/src/errors';
import { SupportFault, SupportService } from '../../../../../modules/support/src';

const SUPPORT = Symbol('laundry.support');

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
    throw new SupportFault('UNAUTHENTICATED', 'Sign in again to continue');
  }
  return header.slice(7);
}

@Catch()
export class SupportEnvelopeFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    noStore(response);
    const traceId = randomUUID();
    if (error instanceof SupportFault) {
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
    console.error('[support]', { traceId, code: 'INTERNAL_FAILURE' });
    return response.status(503).json({
      code: 'PROVIDER_UNAVAILABLE', message: 'Support is temporarily unavailable', traceId, retryable: true,
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

function serviceOf(service: SupportService | null): SupportService {
  if (!service) throw new SupportFault('PROVIDER_UNAVAILABLE', 'Support is not configured');
  return service;
}

@Controller('v2/orders')
@UseFilters(SupportEnvelopeFilter)
export class OrderIncidentsController {
  constructor(@Inject(SUPPORT) private readonly service: SupportService | null) {}

  @Post(':orderId/incidents')
  @HttpCode(200)
  create(@Param('orderId') orderId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).createIncident(bearer(authorization), orderId, v2.incidentInputSchema.parse(input), key);
  }
}

@Controller('v2/incidents')
@UseFilters(SupportEnvelopeFilter)
export class IncidentsController {
  constructor(@Inject(SUPPORT) private readonly service: SupportService | null) {}

  @Get()
  list(@Query() raw: PageQueryRaw, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).listIncidents(bearer(authorization), pageQuery(raw));
  }

  @Get(':incidentId/messages')
  messages(@Param('incidentId') incidentId: string, @Query() raw: PageQueryRaw, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).listMessages(bearer(authorization), incidentId, pageQuery(raw));
  }

  @Post(':incidentId/messages')
  @HttpCode(200)
  append(@Param('incidentId') incidentId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).appendMessage(bearer(authorization), incidentId, v2.incidentMessageInputSchema.parse(input), key);
  }

  @Post(':incidentId/rewash-requests')
  @HttpCode(200)
  rewash(@Param('incidentId') incidentId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).requestRewash(bearer(authorization), incidentId, v2.rewashRequestInputSchema.parse(input), key);
  }
}

@Controller('v2/ops/incidents')
@UseFilters(SupportEnvelopeFilter)
export class OpsIncidentsController {
  constructor(@Inject(SUPPORT) private readonly service: SupportService | null) {}

  @Post(':incidentId/resolve')
  @HttpCode(200)
  resolve(@Param('incidentId') incidentId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).resolveIncident(bearer(authorization), incidentId, v2.incidentResolutionInputSchema.parse(input), key);
  }
}

@Module({})
export class SupportModule {
  static register(factory: () => SupportService | null): DynamicModule {
    return {
      module: SupportModule,
      controllers: [OrderIncidentsController, IncidentsController, OpsIncidentsController],
      providers: [{ provide: SUPPORT, useFactory: factory }],
    };
  }
}
