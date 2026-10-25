import { ArgumentsHost, Body, Catch, Controller, DynamicModule, ExceptionFilter, Get, Headers, HttpCode, Inject, Module, Param, Patch, Post, Query, Res, UseFilters } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { v2 } from '@laundry/contracts';
import { ApiError } from '../../../../../modules/shared/src/errors';
import { CatalogFault, CatalogService } from '../../../../../modules/catalog/src';

const CATALOG = Symbol('laundry.catalog');

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
    throw new CatalogFault('UNAUTHENTICATED', 'Sign in again to continue');
  }
  return header.slice(7);
}

function optionalBearer(header: string | undefined): string | undefined {
  return header && /^Bearer [A-Za-z0-9_-]{43}$/.test(header) ? header.slice(7) : undefined;
}

@Catch()
export class CatalogEnvelopeFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    noStore(response);
    const traceId = randomUUID();
    if (error instanceof CatalogFault) {
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
    console.error('[catalog]', { traceId, code: 'INTERNAL_FAILURE' });
    return response.status(503).json({
      code: 'PROVIDER_UNAVAILABLE', message: 'Catalog is temporarily unavailable', traceId, retryable: true,
    });
  }
}

@Controller('v2/catalog')
@UseFilters(CatalogEnvelopeFilter)
export class CatalogController {
  constructor(@Inject(CATALOG) private readonly service: CatalogService | null) {}
  private get catalog(): CatalogService {
    if (!this.service) throw new CatalogFault('PROVIDER_UNAVAILABLE', 'Catalog is not configured');
    return this.service;
  }

  @Get('services')
  services(@Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.catalog.listServices();
  }

  @Get('services/:serviceId')
  detail(@Param('serviceId') id: string, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.catalog.getService(id, optionalBearer(authorization));
  }

  @Get('garments/eligibility')
  garments(@Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.catalog.listGarmentEligibility();
  }

  @Get('rates/effective')
  rates(@Query('serviceCode') serviceCode: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    if (serviceCode === undefined) throw new CatalogFault('INVALID_INPUT', 'serviceCode is required');
    return this.catalog.effectiveRates(serviceCode === undefined ? undefined : v2.serviceCodeSchema.parse(serviceCode));
  }
}

@Controller('v2/ops/catalog')
@UseFilters(CatalogEnvelopeFilter)
export class OpsCatalogController {
  constructor(@Inject(CATALOG) private readonly service: CatalogService | null) {}
  private get catalog(): CatalogService {
    if (!this.service) throw new CatalogFault('PROVIDER_UNAVAILABLE', 'Catalog is not configured');
    return this.service;
  }

  @Patch('services/:serviceId')
  updateService(@Param('serviceId') id: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.catalog.updateService(bearer(authorization), id, v2.serviceUpdateSchema.parse(input), key);
  }

  @Post('rate-cards')
  @HttpCode(200)
  createRateCard(@Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.catalog.createRateCard(bearer(authorization), v2.rateCardInputSchema.parse(input), key);
  }

  @Post('rate-cards/:rateCardId/approve')
  @HttpCode(200)
  approve(@Param('rateCardId') id: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.catalog.approveRateCard(bearer(authorization), id, v2.versionedReasonSchema.parse(input), key);
  }

  @Post('rate-cards/:rateCardId/activate')
  @HttpCode(200)
  activate(@Param('rateCardId') id: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.catalog.activateRateCard(bearer(authorization), id, v2.versionedReasonSchema.parse(input), key);
  }
}

@Module({})
export class CatalogModule {
  static register(factory: () => CatalogService | null): DynamicModule {
    return {
      module: CatalogModule,
      controllers: [CatalogController, OpsCatalogController],
      providers: [{ provide: CATALOG, useFactory: factory }],
    };
  }
}
