import pgDefault from "pg";
import type { Pool, PoolClient, PoolConfig } from "pg";
const { Pool: PoolImpl } = pgDefault;
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

let pool: Pool | null = null;
let closing: Promise<void> | null = null;

function integerSetting(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function connectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is required in production");
  return "postgres://laundry:laundry_dev_only@localhost:5448/laundry";
}

function poolConfig(url: string, migration = false): PoolConfig {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Invalid PostgreSQL connection configuration"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("A PostgreSQL connection URL is required");
  if (parsed.hostname.endsWith(".neon.tech")) {
    if (!["require", "verify-full"].includes(parsed.searchParams.get("sslmode") ?? "")) {
      throw new Error("Neon connections require sslmode=verify-full");
    }
    // Preserve certificate and hostname verification explicitly across pg
    // upgrades; sslmode=require will adopt weaker libpq semantics in pg 9.
    parsed.searchParams.set("sslmode", "verify-full");
  }
  return {
    connectionString: parsed.toString(),
    max: migration ? 1 : integerSetting("PG_POOL_MAX", 10, 1, 100),
    connectionTimeoutMillis: integerSetting("PG_CONNECTION_TIMEOUT_MS", 10_000, 1, 120_000),
    idleTimeoutMillis: integerSetting("PG_IDLE_TIMEOUT_MS", 30_000, 1, 600_000),
    maxLifetimeSeconds: integerSetting("PG_MAX_LIFETIME_SECONDS", 300, 1, 3600),
    application_name: migration ? "laundry-migrations" : "laundry",
  };
}

function observePoolErrors(db: Pool): Pool {
  // Idle sockets can disappear during Neon suspension, restart or network loss.
  // pg removes them; handling the event prevents an uncaught EventEmitter error.
  db.on("error", error => {
    const code = "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : "CONNECTION_LOST";
    console.error("[database] idle connection removed", { code });
  });
  return db;
}

export function getPool(): Pool {
  if (closing) throw new Error("Database pool is shutting down");
  if (!pool) pool = observePoolErrors(new PoolImpl(poolConfig(connectionString())));
  return pool;
}

export async function closePool(): Promise<void> {
  if (closing) return closing;
  const previous = pool;
  pool = null;
  if (!previous) return;
  closing = previous.end().finally(() => { closing = null; });
  return closing;
}

function migrationDir(): string {
  // Deterministic from a clean clone: walk up from both the caller's cwd
  // (which differs under pnpm --filter) and this module directory, so root,
  // apps/api and dist launches all find the same migration sequence. Never
  // fall back to a workstation-specific absolute path.
  const roots: string[] = [process.cwd(), typeof __dirname !== "undefined" ? __dirname : process.cwd()];
  for (const root of roots) {
    let dir = root;
    for (let i = 0; i < 8; i++) {
      const c = join(dir, "modules", "schema", "migrations");
      if (existsSync(c) && existsSync(join(c, "001_backend.sql"))) return c;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("backend migration directory not found (expected modules/schema/migrations/001_backend.sql)");
}

export async function initializeDb(): Promise<void> {
  const applicationUrl = connectionString();
  const directUrl = process.env.DATABASE_URL_UNPOOLED || applicationUrl;
  let direct: URL;
  try { direct = new URL(directUrl); } catch { throw new Error("Invalid migration connection configuration"); }
  if (direct.hostname.split(".")[0].endsWith("-pooler")) {
    throw new Error("Migrations require a direct connection. Set DATABASE_URL_UNPOOLED to the provider's non-pooled URL.");
  }
  // Do not let a misspelled direct URL migrate a different database or project.
  const application = new URL(applicationUrl);
  const endpoint = (url: URL) => url.hostname.replace(/-pooler(?=\.)/, "");
  if (application.pathname !== direct.pathname || endpoint(application) !== endpoint(direct)) {
    throw new Error("Application and migration connections must identify the same database and endpoint");
  }
  const db = observePoolErrors(new PoolImpl(poolConfig(directUrl, true)));
  let tx: PoolClient | undefined;
  let poisoned = false;
  try {
    tx = await db.connect();
    await tx.query("BEGIN");
    // API and worker startup must not race schema changes. This lock lives on
    // the one direct transaction client, never a pooled session or pool.query.
    await tx.query("SELECT pg_advisory_xact_lock(1835102820, 1)");
    const dir = migrationDir();
    for (const file of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
      await tx.query(readFileSync(join(dir, file), "utf8"));
    }
    await seedDemo(tx);
    await tx.query("COMMIT");
  } catch (error) {
    if (tx) try { await tx.query("ROLLBACK"); } catch { poisoned = true; }
    throw error;
  } finally {
    tx?.release(poisoned);
    await db.end();
  }
}

export const DEMO_IDS = {
  customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  riderId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  operatorId: "eeeeeee1-eeee-4eee-8eee-eeeeeeeeeee1",
  addressId: "66666666-6666-4666-8666-666666666666",
  facilityId: "12121212-1212-4121-8121-121212121212",
};

const DEMO_SERVICES = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    code: "WASH_PRESS",
    name: "Wash and Press",
    description: "Machine wash, dry, and crisp press for everyday cottons.",
    imageFile: "wash-and-iron.svg",
    priceMinor: 7900,
    priceUnit: "from INR 79 per garment",
    turnaroundHours: 48,
    features: ["Free pickup", "48-hour return", "Starch on request"],
    garments: [
      { id: "22222222-2222-4222-8222-222222222222", name: "Shirt", priceMinor: 7900 },
      { id: "33333333-3333-4333-8333-333333333333", name: "Trouser", priceMinor: 8900 },
    ],
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    code: "DRY_CLEAN",
    name: "Dry Cleaning",
    description: "Solvent care for suits, silks, and winter layers.",
    imageFile: "dry-clean.svg",
    priceMinor: 19900,
    priceUnit: "from INR 199 per garment",
    turnaroundHours: 72,
    features: ["Stain pre-check", "Garment bag return"],
    garments: [{ id: "55555555-5555-4555-8555-555555555555", name: "Blazer", priceMinor: 19900 }],
  },
  {
    id: "aaaa1111-1111-4111-8111-111111111112",
    code: "WASH_FOLD",
    name: "Wash and Fold",
    description: "Everyday laundry washed, dried, and neatly folded.",
    imageFile: "wash-and-fold.svg",
    priceMinor: 5900,
    priceUnit: "from INR 59 per garment",
    turnaroundHours: 36,
    features: ["Free pickup", "Folded return"],
    garments: [{ id: "aaaa2222-2222-4222-8222-222222222223", name: "T-shirt", priceMinor: 5900 }],
  },
  {
    id: "bbbb1111-1111-4111-8111-111111111113",
    code: "PRESS_ONLY",
    name: "Steam Press",
    description: "Crisp press for pre-washed garments.",
    imageFile: "steam-press.svg",
    priceMinor: 3900,
    priceUnit: "from INR 39 per garment",
    turnaroundHours: 24,
    features: ["Same-week return"],
    garments: [{ id: "bbbb2222-2222-4222-8222-222222222224", name: "Shirt press", priceMinor: 3900 }],
  },
];

export function demoImageUrl(file: string): string {
  const origin = (process.env.API_ORIGIN ?? "http://localhost:4100").replace(/\/$/, "");
  return `${origin}/assets/services/${file}`;
}

async function seedDemo(db: Pool | PoolClient): Promise<void> {
  const demoMode = (process.env.DEMO_MODE ?? "true") !== "false";
  if (!demoMode) return;
  const customerPhone = process.env.DEMO_CUSTOMER_PHONE ?? "+91-90000-00001";
  const riderPhone = process.env.DEMO_RIDER_PHONE ?? "+91-90000-00002";
  const operatorPhone = process.env.DEMO_OPERATOR_PHONE ?? "+91-90000-00003";
  await db.query(
    `INSERT INTO users (id, role, name, phone) VALUES
      ($1,'customer','Demo Customer',$2),
      ($3,'rider','Demo Rider',$4),
      ($5,'operator','Demo Operator',$6)
     ON CONFLICT (id) DO UPDATE SET phone = EXCLUDED.phone`,
    [DEMO_IDS.customerId, customerPhone, DEMO_IDS.riderId, riderPhone, DEMO_IDS.operatorId, operatorPhone],
  );
  await db.query(
    `INSERT INTO addresses (id, owner_id, label, line1, city, postal_code, version)
     VALUES ($1,$2,'Home (demo)','14 Demo Lane','Bengaluru','560001',1)
     ON CONFLICT (id) DO NOTHING`,
    [DEMO_IDS.addressId, DEMO_IDS.customerId],
  );
  for (const s of DEMO_SERVICES) {
    await db.query(
      `INSERT INTO services (id, code, name, description, image_url, price_minor, price_unit, turnaround_hours, features, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
       ON CONFLICT (id) DO UPDATE SET image_url = EXCLUDED.image_url, price_minor = EXCLUDED.price_minor`,
      [s.id, s.code, s.name, s.description, demoImageUrl(s.imageFile), s.priceMinor, s.priceUnit, s.turnaroundHours, JSON.stringify(s.features)],
    );
    for (const g of s.garments) {
      await db.query(
        `INSERT INTO garment_types (id, service_id, name, price_minor) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET price_minor = EXCLUDED.price_minor`,
        [g.id, s.id, g.name, g.priceMinor],
      );
    }
  }
  await db.query(`INSERT INTO rate_cards (id, version, currency) VALUES ('88888888-8888-4888-8888-888888888888', 1, 'INR') ON CONFLICT DO NOTHING`);
}
