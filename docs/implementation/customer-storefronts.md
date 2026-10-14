# Customer storefront alternatives

The customer web home now displays the public catalog on first visit. Booking still uses the existing API client, explicit demo sign-in, garment basket and quote/checkout flow.

Two views are available: `/?design=classic` and `/?design=handled`. The default is classic. Navigation includes a design switch. Native home remains available through Expo's platform resolution.

## Captured design sources

- Classic: https://www.mrlaundry.cl/ — verified Shopify laundry pickup/delivery storefront. White header, violet navigation, bedding image banner, three booking choices and category/catalog sections.
- Handled: https://tendedpgh.com/ and https://tendedpgh.com/pages/laundry-services — verified Shopify home/laundry service storefront. White header, serif display, full-width lifestyle photography and warm service sections.

These are source-based recreations adapted to Laundry's English content and existing catalog, not exact brand copies. No reliable first/second popularity ranking was found. Reference photography is stored locally under customer/public/images; confirm usage rights before commercial release. No competitor reviews, statistics or guarantees are represented as Laundry's own.

## Design guidance applied

- https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- https://github.com/Leonxlnx/taste-skill
- https://github.com/nextlevelbuilder/ui-ux-pro-max-skill

The full fetched skill text was included in both implementer briefs. Screenshot references override generic palette suggestions. The layouts include visible focus, labeled forms, minimum touch targets, responsive columns, reduced motion and image failure fallback.

## Booking behavior

Service selection starts an explicit demo session and opens the real garment detail route. Catalog data loads without sign-in. Address text on the home page is a preview note; the current demo checkout uses its existing saved address and does not validate arbitrary typed addresses.

Service detail and basket have readable catalog names/prices and bounded responsive layouts. Basket dates use India local time and convert to ISO instants for the unchanged checkout contract. Default pickup is tomorrow at 09:00 Asia/Kolkata. Empty baskets and invalid/past windows cannot proceed.

## Verification

Customer TypeScript and 13 customer tests passed, including five scheduling regressions. Browser and Vercel preview evidence is recorded in the pull request. HTML previews are standalone design demos with simulated interactions; the Expo deployment exercises the existing API booking flow.

The local pnpm wrapper resolved to v11 and rejected ignored dependency build scripts. Direct local TypeScript/Vitest/Expo binaries worked after exposing already-installed transitive Expo dependencies through ignored node_modules links. No generated package-manager policy edits are retained.
