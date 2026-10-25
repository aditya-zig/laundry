import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { demoMode } from '../../../../modules/shared/src/auth';
import { ApiError } from '../../../../modules/shared/src/errors';

/** v1 catalog/provider handlers still use synthetic settings and historical
 * demo state. Public route reachability must not turn those into live services
 * just because the caller has configured the independent v2 identity module. */
@Injectable()
export class LegacyDemoOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (demoMode()) return true;
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    throw new ApiError('PROVIDER_UNAVAILABLE', 'Legacy integration is unavailable outside the explicit nonproduction demo', { status: 503, retryable: false });
  }
}
