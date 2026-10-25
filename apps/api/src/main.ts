import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { AppModule } from "./app.module";
import { EnvelopeFilter } from "./filters/http-exception.filter";
import { getPool, initializeDb } from "../../../modules/shared/src/db";
import { identityFromEnvironment } from "../../../modules/identity/src";
import { assertProductionConfig, resolveCorsOrigins } from "./runtime-config";
import { configureHttpBody } from "./http-body";

function resolveServiceAssets(): string {
  // Walk up from both cwd (which differs under pnpm --filter) and this
  // module directory so root, apps/api and dist launches serve the same
  // folder. No workstation-specific absolute paths.
  const roots: string[] = [process.cwd(), typeof __dirname !== "undefined" ? __dirname : process.cwd()];
  for (const root of roots) {
    let dir = root;
    for (let i = 0; i < 8; i++) {
      const c = join(dir, "assets", "services");
      if (existsSync(c)) return c;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return join(process.cwd(), "assets", "services");
}

async function bootstrap() {
  assertProductionConfig();
  // Check configured identity before migrations/listening; no provider send.
  if (process.env.NODE_ENV === 'production') identityFromEnvironment(getPool());
  await initializeDb();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.enableShutdownHooks(["SIGINT", "SIGTERM"]);
  app.enableCors({
    origin: resolveCorsOrigins(),
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });
  app.useGlobalFilters(new EnvelopeFilter());
  configureHttpBody(app);
  // Serve only the Freebuff service asset folder, nothing else. Resolve from
  // the module directory so pnpm --filter launches work; cwd differs there.
  // Only SVG originals exist; native-safe PNG variants are served if present.
  app.useStaticAssets(resolveServiceAssets(), { prefix: "/assets/services/" });
  // Keep the raw buffer for webhook HMAC verification.
  app.use((req: { rawBody?: Buffer }, _res: unknown, next: () => void) => {
    void _res;
    next();
  });
  const port = Number(process.env.PORT ?? 4100);
  // Loopback by default. A container or LAN demo must opt in with HOST=0.0.0.0.
  const host = process.env.HOST ?? "127.0.0.1";
  await app.listen(port, host);
  // eslint-disable-next-line no-console
  console.log(`[laundry-api] listening on http://${host}:${port}`);
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[laundry-api] fatal", e);
  process.exit(1);
});
