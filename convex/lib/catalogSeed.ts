// Demo seed catalog. Logical IDs, INR minor-unit prices, and garment rows
// match modules/shared/src/db.ts. Image URLs use ASSET_BASE_URL with the
// Vercel /assets/services/*.png origin. Synthetic demo data only.

export const DEMO_IDS = {
  customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  riderId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  operatorId: "eeeeeee1-eeee-4eee-8eee-eeeeeeeeeee1",
  addressId: "66666666-6666-4666-8666-666666666666",
  rateCardId: "88888888-8888-4888-8888-888888888888",
};

export function assetBaseUrl(): string {
  const base =
    (process.env as Record<string, string | undefined>).ASSET_BASE_URL ??
    (process.env as Record<string, string | undefined>).APP_ORIGIN ??
    "https://demo.local";
  return base.replace(/\/$/, "");
}

export interface SeedGarment {
  lid: string;
  name: string;
  priceMinor: number;
}

export interface SeedService {
  lid: string;
  code: "WASH_FOLD" | "WASH_PRESS" | "PRESS_ONLY" | "DRY_CLEAN";
  name: string;
  description: string;
  imageFile: string;
  priceMinor: number;
  priceUnit: string;
  turnaroundHours: number;
  features: string[];
  garments: SeedGarment[];
}

export const DEMO_SERVICES: SeedService[] = [
  {
    lid: "11111111-1111-4111-8111-111111111111",
    code: "WASH_PRESS",
    name: "Wash and Press",
    description: "Machine wash, dry, and crisp press for everyday cottons.",
    imageFile: "wash-and-iron.png",
    priceMinor: 7900,
    priceUnit: "from INR 79 per garment",
    turnaroundHours: 48,
    features: ["Free pickup", "48-hour return", "Starch on request"],
    garments: [
      { lid: "22222222-2222-4222-8222-222222222222", name: "Shirt", priceMinor: 7900 },
      { lid: "33333333-3333-4333-8333-333333333333", name: "Trouser", priceMinor: 8900 },
    ],
  },
  {
    lid: "44444444-4444-4444-8444-444444444444",
    code: "DRY_CLEAN",
    name: "Dry Cleaning",
    description: "Solvent care for suits, silks, and winter layers.",
    imageFile: "dry-clean.png",
    priceMinor: 19900,
    priceUnit: "from INR 199 per garment",
    turnaroundHours: 72,
    features: ["Stain pre-check", "Garment bag return"],
    garments: [
      { lid: "55555555-5555-4555-8555-555555555555", name: "Blazer", priceMinor: 19900 },
    ],
  },
  {
    lid: "aaaa1111-1111-4111-8111-111111111112",
    code: "WASH_FOLD",
    name: "Wash and Fold",
    description: "Everyday laundry washed, dried, and neatly folded.",
    imageFile: "wash-and-fold.png",
    priceMinor: 5900,
    priceUnit: "from INR 59 per garment",
    turnaroundHours: 36,
    features: ["Free pickup", "Folded return"],
    garments: [
      { lid: "aaaa2222-2222-4222-8222-222222222223", name: "T-shirt", priceMinor: 5900 },
    ],
  },
  {
    lid: "bbbb1111-1111-4111-8111-111111111113",
    code: "PRESS_ONLY",
    name: "Steam Press",
    description: "Crisp press for pre-washed garments.",
    imageFile: "steam-press.png",
    priceMinor: 3900,
    priceUnit: "from INR 39 per garment",
    turnaroundHours: 24,
    features: ["Same-week return"],
    garments: [
      { lid: "bbbb2222-2222-4222-8222-222222222224", name: "Shirt press", priceMinor: 3900 },
    ],
  },
];

export function demoImageUrl(file: string): string {
  return `${assetBaseUrl()}/assets/services/${file}`;
}
