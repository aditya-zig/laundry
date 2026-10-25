import { ArgumentsHost, Body, Catch, Controller, DynamicModule, ExceptionFilter, Get, Headers, HttpCode, Inject, Module, Param, Put, Query, Res, UseFilters } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { v2 } from '@laundry/contracts';
import { ApiError } from '../../../../../modules/shared/src/errors';
import { AvailabilityFault, AvailabilityService } from '../../../../../modules/availability/src';

const AVAILABILITY = Symbol('laundry.availability');

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
    throw new AvailabilityFault('UNAUTHENTICATED', 'Sign in again to continue');
  }
  return header.slice(7);
}

@Catch()
export class AvailabilityEnvelopeFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    noStore(response);
    const traceId = randomUUID();
    if (error instanceof AvailabilityFault) {
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
    console.error('[availability]', { traceId, code: 'INTERNAL_FAILURE' });
    return response.status(503).json({
      code: 'PROVIDER_UNAVAILABLE', message: 'Availability is temporarily unavailable', traceId, retryable: true,
    });
  }
}

interface SlotQueryRaw {
  areaId?: string;
  from?: string;
  to?: string;
  serviceIds?: string;
  requestedReturnBy?: string;
}

@Controller('v2/availability')
@UseFilters(AvailabilityEnvelopeFilter)
export class AvailabilityController {
  constructor(@Inject(AVAILABILITY) private readonly service: AvailabilityService | null) {}
  private get availability(): AvailabilityService {
    if (!this.service) throw new AvailabilityFault('PROVIDER_UNAVAILABLE', 'Availability is not configured');
    return this.service;
  }

  @Get('areas/:postalCode')
  area(@Param('postalCode') postalCode: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.availability.checkArea(postalCode);
  }

  @Get('slots')
  slots(@Query() raw: SlotQueryRaw, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.availability.listSlots({
      areaId: raw.areaId,
      from: raw.from,
      to: raw.to,
      serviceIds: raw.serviceIds === undefined ? undefined : raw.serviceIds.split(',').filter(Boolean),
      requestedReturnBy: raw.requestedReturnBy,
    } as v2.SlotQuery);
  }
}

interface CalendarQueryRaw {
  areaId?: string;
  from?: string;
  to?: string;
}

@Controller('v2/ops/availability')
@UseFilters(AvailabilityEnvelopeFilter)
export class OpsAvailabilityController {
  constructor(@Inject(AVAILABILITY) private readonly service: AvailabilityService | null) {}
  private get availability(): AvailabilityService {
    if (!this.service) throw new AvailabilityFault('PROVIDER_UNAVAILABLE', 'Availability is not configured');
    return this.service;
  }

  @Get('calendar')
  calendar(@Query() raw: CalendarQueryRaw, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.availability.operationsCalendar(bearer(authorization), raw);
  }

  @Put('capacity')
  @HttpCode(200)
  capacity(@Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.availability.setCapacity(bearer(authorization), v2.capacityUpdateSchema.parse(input), key);
  }
}

@Module({})
export class AvailabilityModule {
  static register(factory: () => AvailabilityService | null): DynamicModule {
    return {
      module: AvailabilityModule,
      controllers: [AvailabilityController, OpsAvailabilityController],
      providers: [{ provide: AVAILABILITY, useFactory: factory }],
    };
  }
}
