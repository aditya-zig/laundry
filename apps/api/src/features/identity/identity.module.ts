import { ArgumentsHost, Body, Catch, Controller, Delete, DynamicModule, ExceptionFilter, Get, Headers, HttpCode, Inject, Module, Param, Patch, Post, Req, Res, UseFilters } from '@nestjs/common';
interface Response {
  setHeader(name: string, value: string): unknown;
  status(code: number): Response;
  json(body: unknown): unknown;
}
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { v2 } from '@laundry/contracts';
import { IdentityService, IdentityFault } from '../../../../../modules/identity/src';

const IDENTITY = Symbol('laundry.identity');
interface RequestContext { socket?: { remoteAddress?: string } }
function token(header: string | undefined): string {
  if (!header || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) throw new IdentityFault('UNAUTHENTICATED', 'Sign in again to continue');
  return header.slice(7);
}
function peer(request: RequestContext): string {
  // Never trust caller-controlled X-Forwarded-For. Production proxy identity
  // must be verified by the ingress before adding an alternative trusted key.
  return request.socket?.remoteAddress ?? 'unknown-peer';
}
function noStore(response: Response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

@Catch()
export class IdentityEnvelopeFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    noStore(response);
    const traceId = randomUUID();
    if (error instanceof IdentityFault) {
      return response.status(v2.errorHttpStatus[error.code]).json(v2.errorEnvelopeSchema.parse({ code: error.code, message: error.message, traceId, retryable: v2.errorRetryable[error.code], currentVersion: error.currentVersion }));
    }
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues.slice(0, 50)) (fieldErrors[issue.path.join('.') || 'body'] ??= []).push(issue.message);
      return response.status(400).json({ code: 'INVALID_INPUT', message: 'Request failed validation', traceId, retryable: false, fieldErrors });
    }
    // No provider/DB exception object or body can leak credentials into logs.
    console.error('[identity]', { traceId, code: 'INTERNAL_FAILURE' });
    return response.status(503).json({ code: 'PROVIDER_OUTCOME_UNKNOWN', message: 'Identity is temporarily unavailable', traceId, retryable: true });
  }
}

@Controller('v2/identity')
@UseFilters(IdentityEnvelopeFilter)
export class IdentityController {
  constructor(@Inject(IDENTITY) private readonly service: IdentityService | null) {}
  private get identity(): IdentityService {
    if (!this.service) throw new IdentityFault('PROVIDER_UNAVAILABLE', 'Identity delivery is not configured');
    return this.service;
  }
  @Post('otp')
  @HttpCode(200)
  request(@Body() input: unknown, @Headers('idempotency-key') key: string, @Req() request: RequestContext, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.identity.requestOtp(v2.otpRequestSchema.parse(input), key, peer(request));
  }
  @Post('otp/verify')
  @HttpCode(200)
  verify(@Body() input: unknown, @Headers('idempotency-key') key: string, @Req() request: RequestContext, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.identity.verifyOtp(v2.otpVerifySchema.parse(input), key, peer(request));
  }
  @Post('session/refresh')
  @HttpCode(200)
  refresh(@Body() input: unknown, @Headers('idempotency-key') key: string, @Req() request: RequestContext, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.identity.refresh(v2.sessionRefreshSchema.parse(input), key, peer(request));
  }
  @Get('me')
  async me(@Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return (await this.identity.authenticate(token(authorization))).actor;
  }
  @Post('logout')
  @HttpCode(200)
  logout(@Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.identity.logout(token(authorization), key);
  }
  @Post('sessions/:sessionId/revoke')
  @HttpCode(200)
  revoke(@Param('sessionId') id: string, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.identity.revoke(token(authorization), id, key);
  }
  @Post('staff/invitations')
  @HttpCode(200)
  inviteStaff(@Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.identity.inviteStaff(token(authorization), v2.staffInvitationSchema.parse(input), key);
  }

  @Post('staff/mfa')
  @HttpCode(200)
  staffMfa(@Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.identity.configureStaffMfa(token(authorization), v2.staffMfaSetupSchema.parse(input), key);
  }

  @Post('whatsapp/link')
  @HttpCode(200)
  linkWhatsApp(@Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.identity.linkWhatsApp(token(authorization), v2.whatsAppLinkSchema.parse(input), key);
  }
  @Get('addresses')
  addresses(@Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.identity.listAddresses(token(authorization));
  }
  @Post('addresses')
  @HttpCode(200)
  createAddress(@Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.identity.createAddress(token(authorization), v2.addressInputSchema.parse(input), key);
  }
  @Patch('addresses/:addressId')
  updateAddress(@Param('addressId') id: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.identity.updateAddress(token(authorization), id, v2.addressUpdateSchema.parse(input), key);
  }
  @Delete('addresses/:addressId')
  deleteAddress(@Param('addressId') id: string, @Body() input: unknown, @Headers('authorization') authorization: string | undefined, @Headers('idempotency-key') key: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.identity.deleteAddress(token(authorization), id, v2.addressDeleteSchema.parse(input).expectedVersion, key);
  }
}

@Module({})
export class IdentityModule {
  static register(factory: () => IdentityService | null): DynamicModule {
    return { module: IdentityModule, controllers: [IdentityController], providers: [{ provide: IDENTITY, useFactory: factory }] };
  }
}
