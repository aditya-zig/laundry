import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { getPool } from "../../../../modules/shared/src/db";
import { actorFromToken } from "../../../../modules/shared/src/auth";

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = (req.headers.authorization ?? "") as string;
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    const actor = await actorFromToken(getPool(), token);
    if (!actor) throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "Missing or invalid session", traceId: "trace-auth", retryable: false });
    req.actor = actor;
    req.token = token;
    return true;
  }
}

/** Public routes skip AuthGuard via @Public() metadata. */
import { SetMetadata } from "@nestjs/common";
export const Public = () => SetMetadata("public", true);
