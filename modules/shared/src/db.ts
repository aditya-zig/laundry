import pgDefault from "pg";
import type { Pool } from "pg";
const { Pool: PoolImpl } = pgDefault;
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const connectionString =
    process.env.DATABASE_URL ?? "postgres://laundry:laundry_dev_only@localhost:5448/laundry";
  pool = new PoolImpl({ connectionString, max: 10 });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
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
  const db = getPool();
  const dir = migrationDir();
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    await db.query(sql);
  }
  await seedDemo(db);
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

async function seedDemo(db: Pool): Promise<void> {
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
