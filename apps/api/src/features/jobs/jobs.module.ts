import { ArgumentsHost, Body, Catch, Controller, DynamicModule, ExceptionFilter, Get, Headers, HttpCode, Inject, Module, Param, Post, Query, Res, UseFilters } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { v2 } from '@laundry/contracts';
import { ApiError } from '../../../../../modules/shared/src/errors';
import { JobsFault, JobsService } from '../../../../../modules/jobs/src';

const JOBS = Symbol('laundry.jobs');

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
    throw new JobsFault('UNAUTHENTICATED', 'Sign in again to continue');
  }
  return header.slice(7);
}

@Catch()
export class JobsEnvelopeFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    noStore(response);
    const traceId = randomUUID();
    if (error instanceof JobsFault) {
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
    console.error('[jobs]', { traceId, code: 'INTERNAL_FAILURE' });
    return response.status(503).json({
      code: 'PROVIDER_UNAVAILABLE', message: 'Job operations are temporarily unavailable', traceId, retryable: true,
    });
  }
}

@Controller('v2/ops/jobs')
@UseFilters(JobsEnvelopeFilter)
export class JobsController {
  constructor(@Inject(JOBS) private readonly service: JobsService | null) {}
  private get jobs(): JobsService {
    if (!this.service) throw new JobsFault('PROVIDER_UNAVAILABLE', 'Job operations are not configured');
    return this.service;
  }

  @Get('health')
  health(@Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.jobs.health(bearer(authorization));
  }

  @Get('dead-letter')
  deadLetters(@Query() raw: { cursor?: string; limit?: string }, @Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.jobs.deadLetters(bearer(authorization), {
      ...(raw.cursor === undefined ? {} : { cursor: raw.cursor }),
      ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
    });
  }

  @Post(':jobId/replay')
  @HttpCode(200)
  replay(@Param('jobId') jobId: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.jobs.replay(bearer(authorization), jobId, v2.jobReplaySchema.parse(input), key);
  }
}

@Module({})
export class JobsModule {
  static register(factory: () => JobsService | null): DynamicModule {
    return {
      module: JobsModule,
      controllers: [JobsController],
      providers: [{ provide: JOBS, useFactory: factory }],
    };
  }
}
