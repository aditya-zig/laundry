import type { NestExpressApplication } from '@nestjs/platform-express';
import type { IncomingMessage } from 'node:http';
import { demoMode } from '../../../modules/shared/src/auth';

export function configureHttpBody(app: NestExpressApplication): void {
  // Only the explicit non-production voice fixture transports base64 audio.
  // Ordinary identity/business/webhook JSON must not inherit a 15 MB parser.
  app.useBodyParser('json', {
    limit: '15mb',
    type: (request: IncomingMessage) => demoMode() && request.url?.split('?')[0] === '/v1/demo/conversations/voice-notes' &&
      /^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type'] ?? ''),
  });
  app.useBodyParser('json', { limit: '64kb' });
  app.useBodyParser('urlencoded', { limit: '64kb', extended: false });
}
