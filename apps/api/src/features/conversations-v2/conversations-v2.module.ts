import { ArgumentsHost, Body, Catch, Controller, DynamicModule, ExceptionFilter, Headers, HttpCode, Inject, Module, Param, Post, Req, Res, UseFilters } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { v2 } from '@laundry/contracts';
import { ApiError } from '../../../../../modules/shared/src/errors';
import { ConversationsFault, ConversationsService } from '../../../../../modules/conversations/src';

const CONVERSATIONS = Symbol('laundry.conversations');

interface Response {
  setHeader(name: string, value: string): unknown;
  status(code: number): Response;
  json(body: unknown): unknown;
}

interface RawRequest {
  rawBody?: Buffer;
}

function noStore(response: Response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function bearer(header: string | undefined): string {
  if (!header || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) {
    throw new ConversationsFault('UNAUTHENTICATED', 'Sign in again to continue');
  }
  return header.slice(7);
}

function idempotencyKey(key: string | undefined): string {
  if (!key || !key.trim()) throw new ConversationsFault('INVALID_INPUT', 'An Idempotency-Key header is required');
  return key;
}

function signature(headers: Record<string, string | undefined>): string | undefined {
  // Meta signs with x-hub-signature-256. The other two names keep the adapter
  // provider-neutral for an alternate sender with the same raw-body HMAC.
  return headers['x-hub-signature-256'] ?? headers['x-signature-256'] ?? headers['x-signature'];
}

@Catch()
export class ConversationsEnvelopeFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    noStore(response);
    const traceId = randomUUID();
    if (error instanceof ConversationsFault) {
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
    console.error('[conversations]', { traceId, code: 'INTERNAL_FAILURE' });
    return response.status(503).json({
      code: 'PROVIDER_UNAVAILABLE', message: 'Conversations are temporarily unavailable', traceId, retryable: true,
    });
  }
}

@Controller('v2/webhooks/conversations')
@UseFilters(ConversationsEnvelopeFilter)
export class ConversationWebhookController {
  constructor(@Inject(CONVERSATIONS) private readonly service: ConversationsService | null) {}
  private get conversations(): ConversationsService {
    if (!this.service) throw new ConversationsFault('PROVIDER_UNAVAILABLE', 'Conversations are not configured');
    return this.service;
  }

  /**
   * The signature covers the exact received bytes, so the raw body is read
   * before any parsing. Nest stores it when the app enables rawBody.
   */
  @Post(':provider')
  @HttpCode(200)
  inbound(
    @Param('provider') provider: string,
    @Req() request: RawRequest,
    @Headers() headers: Record<string, string | undefined>,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    if (!Buffer.isBuffer(request.rawBody)) {
      throw new ConversationsFault('INVALID_INPUT', 'A signed raw body is required');
    }
    return this.conversations.receive(request.rawBody, signature(headers), provider);
  }
}

@Controller('v2/conversations')
@UseFilters(ConversationsEnvelopeFilter)
export class ConversationsController {
  constructor(@Inject(CONVERSATIONS) private readonly service: ConversationsService | null) {}
  private get conversations(): ConversationsService {
    if (!this.service) throw new ConversationsFault('PROVIDER_UNAVAILABLE', 'Conversations are not configured');
    return this.service;
  }

  @Post('drafts/:draftId/confirm')
  @HttpCode(200)
  confirm(
    @Param('draftId') draftId: string,
    @Body() input: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.conversations.confirm(bearer(authorization), draftId, v2.draftConfirmationSchema.parse(input), idempotencyKey(key));
  }

  @Post('opt-out')
  @HttpCode(200)
  optOut(
    @Body() input: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.conversations.optOut(bearer(authorization), v2.conversationOptOutSchema.parse(input), idempotencyKey(key));
  }
}

@Controller('v2/ops/conversations')
@UseFilters(ConversationsEnvelopeFilter)
export class OpsConversationsController {
  constructor(@Inject(CONVERSATIONS) private readonly service: ConversationsService | null) {}
  private get conversations(): ConversationsService {
    if (!this.service) throw new ConversationsFault('PROVIDER_UNAVAILABLE', 'Conversations are not configured');
    return this.service;
  }

  @Post(':draftId/handoff')
  @HttpCode(200)
  handoff(
    @Param('draftId') draftId: string,
    @Body() input: unknown,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.conversations.handoff(bearer(authorization), draftId, v2.conversationHandoffSchema.parse(input), idempotencyKey(key));
  }
}

@Module({})
export class ConversationsModule {
  static register(factory: () => ConversationsService | null): DynamicModule {
    return {
      module: ConversationsModule,
      controllers: [ConversationWebhookController, ConversationsController, OpsConversationsController],
      providers: [{ provide: CONVERSATIONS, useFactory: factory }],
    };
  }
}
