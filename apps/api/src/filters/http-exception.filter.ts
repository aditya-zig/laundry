import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ApiError } from "../../../../modules/shared/src/errors";

@Catch()
export class EnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const traceId = randomUUID();
    if (exception instanceof ApiError) {
      return res.status(exception.status).json({ ...exception.toEnvelope(), traceId: exception.traceId });
    }
    // Zod request validation → contract INVALID_INPUT, never a 500.
    const issues = (exception as { issues?: { path: (string | number)[]; message: string }[] })?.issues;
    if (Array.isArray(issues)) {
      const fieldErrors: Record<string, string> = {};
      for (const i of issues) fieldErrors[i.path.join(".") || "body"] = i.message;
      return res.status(400).json({ code: "INVALID_INPUT", message: "Request failed validation", traceId, retryable: false, fieldErrors });
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse() as Record<string, unknown>;
      const code = (body?.code as string) ?? (exception.getStatus() === 401 ? "UNAUTHENTICATED" : exception.getStatus() === 403 ? "FORBIDDEN" : exception.getStatus() === 404 ? "NOT_FOUND" : "INVALID_INPUT");
      return res.status(exception.getStatus()).json({
        code, message: (body?.message as string) ?? exception.message, traceId, retryable: exception.getStatus() >= 500,
      });
    }
    // eslint-disable-next-line no-console
    console.error(`[api:${traceId}]`, exception);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: "PROVIDER_OUTCOME_UNKNOWN", message: "Internal error", traceId, retryable: true,
    });
  }
}
