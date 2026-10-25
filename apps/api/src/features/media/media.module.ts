import { ArgumentsHost, Body, Catch, Controller, DynamicModule, ExceptionFilter, Headers, HttpCode, Inject, Module, Param, Post, Res, UseFilters } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { v2 } from '@laundry/contracts';
import { ApiError } from '../../../../../modules/shared/src/errors';
import { MediaFault, MediaService } from '../../../../../modules/media/src';

const MEDIA = Symbol('laundry.media');

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
    throw new MediaFault('UNAUTHENTICATED', 'Sign in again to continue');
  }
  return header.slice(7);
}

@Catch()
export class MediaEnvelopeFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    noStore(response);
    const traceId = randomUUID();
    if (error instanceof MediaFault) {
      return response.status(v2.errorHttpStatus[error.code]).json(v2.errorEnvelopeSchema.parse({
        code: error.code, message: error.message, traceId, retryable: v2.errorRetryable[error.code],
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
    console.error('[media]', { traceId, code: 'INTERNAL_FAILURE' });
    return response.status(503).json({
      code: 'PROVIDER_UNAVAILABLE', message: 'Media is temporarily unavailable', traceId, retryable: true,
    });
  }
}

@Controller('v2/media')
@UseFilters(MediaEnvelopeFilter)
export class MediaController {
  constructor(@Inject(MEDIA) private readonly service: MediaService | null) {}
  private get media(): MediaService {
    if (!this.service) throw new MediaFault('PROVIDER_UNAVAILABLE', 'Media is not configured');
    return this.service;
  }

  /** No route serves object bytes. An intent only returns an upload target. */
  @Post('upload-intents')
  @HttpCode(200)
  intent(@Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.media.createUploadIntent(bearer(authorization), v2.uploadIntentSchema.parse(input), key);
  }

  @Post(':mediaId/finalize')
  @HttpCode(200)
  finalize(@Param('mediaId') mediaId: string, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.media.finalizeUpload(bearer(authorization), mediaId, key);
  }

  @Post(':mediaId/download')
  @HttpCode(200)
  download(@Param('mediaId') mediaId: string, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.media.download(bearer(authorization), mediaId, key);
  }
}

@Module({})
export class MediaModule {
  static register(factory: () => MediaService | null): DynamicModule {
    return {
      module: MediaModule,
      controllers: [MediaController],
      providers: [{ provide: MEDIA, useFactory: factory }],
    };
  }
}
