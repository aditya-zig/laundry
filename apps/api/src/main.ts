import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { AppModule } from "./app.module";
import { EnvelopeFilter } from "./filters/http-exception.filter";
import { initializeDb } from "../../../modules/shared/src/db";

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

function assertProductionConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  // Production must never run on implicit demo/default credentials.
  const problems: string[] = [];
  if ((process.env.DEMO_MODE ?? "true") !== "false") problems.push("DEMO_MODE must be 'false' in production");
  if (!process.env.DATABASE_URL || /localhost|wandary_dev_only/.test(process.env.DATABASE_URL)) {
    problems.push("DATABASE_URL must point at the production database");
  }
  for (const k of ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]) {
    if (!process.env[k]) problems.push(`${k} must be configured in production`);
  }
  if ((process.env.WHATSAPP_VERIFY_TOKEN ?? "") === "demo-verify-token") {
    problems.push("WHATSAPP_VERIFY_TOKEN must not be the demo default in production");
  }
  if (problems.length) throw new Error(`Refusing production start: ${problems.join("; ")}`);
}

async function bootstrap() {
  assertProductionConfig();
  await initializeDb();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.enableCors({
    origin: ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://localhost:8081", "http://localhost:8082", "http://localhost:5173", "http://localhost:19006"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });
  app.useGlobalFilters(new EnvelopeFilter());
  // Voice notes carry base64 audio (up to ~14 MB JSON); raise the JSON limit.
  app.useBodyParser?.("json", { limit: "15mb" });
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
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[wandary-api] listening on http://localhost:${port}`);
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[wandary-api] fatal", e);
  process.exit(1);
});
