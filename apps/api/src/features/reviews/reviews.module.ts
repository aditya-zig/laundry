import { ArgumentsHost, Body, Catch, Controller, DynamicModule, ExceptionFilter, Get, Headers, HttpCode, Inject, Module, Param, Post, Query, Res, UseFilters } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { v2 } from '@laundry/contracts';
import { ApiError } from '../../../../../modules/shared/src/errors';
import { ReviewsFault, ReviewsService } from '../../../../../modules/reviews/src';

const REVIEWS = Symbol('laundry.reviews');

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
    throw new ReviewsFault('UNAUTHENTICATED', 'Sign in again to continue');
  }
  return header.slice(7);
}

@Catch()
export class ReviewsEnvelopeFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    noStore(response);
    const traceId = randomUUID();
    if (error instanceof ReviewsFault) {
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
    console.error('[reviews]', { traceId, code: 'INTERNAL_FAILURE' });
    return response.status(503).json({
      code: 'PROVIDER_UNAVAILABLE', message: 'Reviews are temporarily unavailable', traceId, retryable: true,
    });
  }
}

interface ReviewQueryRaw {
  cursor?: string;
  limit?: string;
  serviceId?: string;
}

function reviewQuery(raw: ReviewQueryRaw) {
  return {
    ...(raw.cursor === undefined ? {} : { cursor: raw.cursor }),
    ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
    ...(raw.serviceId === undefined ? {} : { serviceId: raw.serviceId }),
  };
}

function serviceOf(service: ReviewsService | null): ReviewsService {
  if (!service) throw new ReviewsFault('PROVIDER_UNAVAILABLE', 'Reviews are not configured');
  return service;
}

@Controller('v2/orders')
@UseFilters(ReviewsEnvelopeFilter)
export class OrderReviewsController {
  constructor(@Inject(REVIEWS) private readonly service: ReviewsService | null) {}

  @Post(':orderId/reviews')
  @HttpCode(200)
  create(@Param('orderId') orderId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).create(bearer(authorization), orderId, v2.reviewInputSchema.parse(input), key);
  }
}

@Controller('v2/reviews')
@UseFilters(ReviewsEnvelopeFilter)
export class ReviewsController {
  constructor(@Inject(REVIEWS) private readonly service: ReviewsService | null) {}

  @Get()
  publicList(@Query() raw: ReviewQueryRaw, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).publicReviews(reviewQuery(raw));
  }

  @Get('eligibility/:orderId')
  eligibility(@Param('orderId') orderId: string, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).eligibility(bearer(authorization), orderId);
  }
}

@Controller('v2/ops/reviews')
@UseFilters(ReviewsEnvelopeFilter)
export class OpsReviewsController {
  constructor(@Inject(REVIEWS) private readonly service: ReviewsService | null) {}

  @Post(':reviewId/moderation')
  @HttpCode(200)
  moderate(@Param('reviewId') reviewId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return serviceOf(this.service).moderate(bearer(authorization), reviewId, v2.reviewModerationInputSchema.parse(input), key);
  }
}

@Module({})
export class ReviewsModule {
  static register(factory: () => ReviewsService | null): DynamicModule {
    return {
      module: ReviewsModule,
      controllers: [OrderReviewsController, ReviewsController, OpsReviewsController],
      providers: [{ provide: REVIEWS, useFactory: factory }],
    };
  }
}
