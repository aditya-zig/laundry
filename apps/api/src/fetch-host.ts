import { createApplication } from './main';
import { createNodeFetchHandler } from './node-http-fetch';
import { assertManagedDatabaseAliases } from './runtime-config';

let handler: ReturnType<typeof createNodeFetchHandler> | undefined;

/** Managed Node host for the same compiled application, not a parallel API.
 * Provider-created database aliases may contain only our restricted runtime
 * credential. Never discard or conceal an injected owner connection. */
export default {
  fetch(request: Request): Promise<Response> {
    handler ??= createNodeFetchHandler(async () => {
      assertManagedDatabaseAliases();
      const app = await createApplication();
      await app.init();
      return { server: app.getHttpServer(), close: () => app.close() };
    }, { originSecret: process.env.API_ORIGIN_SECRET ?? '', timeoutMs: 30_000 });
    return handler.fetch(request);
  },
};
