# DESIGN.md — Laundry (Wandary project)

OpenDesign binding for this repo. Borrowed structure from the
`dashboard` + `mobile-app` templates and the `expo` / `clean` / `minimal`
systems. Tokens stay identical to `@wandary/design-tokens`. No new hues.

## 1. Color

- Surface `#FFFFFF`, tint `#EEF4FF`, card `#F8FAFC`
- Ink `#0F1F3D`, muted `#4A5A78`
- Action teal `#0E7C7B`, pressed `#0A5F5E`
- Danger `#B3261E`, warning `#8A5A00`, success `#1B7A3D`
- Border `#D7E0F0`, focus ring teal at 24% opacity
- Accent budget: teal is the only accent. One primary action per screen.
  Status uses text plus shape, never color alone.

## 2. Typography

- Font stack: `System, -apple-system, "Segoe UI", Roboto, sans-serif`
- Sizes: caption 12, body 16, title 20, display 28
- Headings 700 weight, tight spacing. Body 400/600 only.
- Minimum touch target 44px. Minimum body text 14px on web, 16px in apps.

## 3. Layout

- Mobile (customer/partner): max width 560, 16px gutters, 12px card radius,
  20px hero radius. One job per screen. Sections in cards with 16px padding.
- Ops console (dashboard template): sidebar 240px with brand, nav, role card.
  Topbar with page title plus environment pill. Main grid: KPI row of 4,
  then tables and workflow cards. Content max 1120px. 8px grid.
- Breakpoints: 390px phone with no horizontal scroll, 768px tablet,
  1120px desktop. Tables scroll horizontally inside cards on small screens.

## 4. Components

- Buttons: primary teal fill, white 700 text, 12px radius, 44px min height.
  Secondary is 1px teal outline with teal text. Danger is text-only except
  destructive confirm. Disabled at 50% opacity.
- Cards: white fill, 1px `#D7E0F0` border, 12px radius, 8px soft shadow.
  Tint cards use `#EEF4FF` with no border shadow.
- Inputs: 8px radius, 1px border, 10px padding, visible focus ring.
  Labels above inputs, 600 weight.
- Status pills: 999px radius, 12px bold uppercase label, tinted background
  per state. Always paired with plain text status.
- Empty/loading/error: centered card, one headline, one explanation,
  one action. Demo surfaces carry an explicit DEMO pill.

## 5. Rules

- Text never depends on an image. Every image has a text fallback.
- One primary action per screen. Destructive actions need a reason field.
- Keep `Laundry` as the displayed product name. Keep package names,
  slugs, and schemes unchanged.
- Contracts and API shapes are untouched. Apps use `@wandary/api-client`.
