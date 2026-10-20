// Stable visual tokens shared by customer, partner, and ops surfaces.
// Bright white + pale blue surfaces, deep navy text, teal actions.
// OpenDesign binding: structure follows the dashboard + mobile-app templates
// and the expo / clean / minimal systems. Values below are the source of
// truth; app themes mirror them. See DESIGN.md at the repo root.
export const colors = {
  surface: "#FFFFFF",
  surfaceTint: "#EEF4FF",
  surfaceCard: "#F8FAFC",
  ink: "#0F1F3D",
  inkMuted: "#4A5A78",
  action: "#0E7C7B",
  actionPressed: "#0A5F5E",
  actionSoft: "#DDF3F2",
  danger: "#B3261E",
  dangerSoft: "#FDECEA",
  warning: "#8A5A00",
  warningSoft: "#FFF4D6",
  success: "#1B7A3D",
  successSoft: "#E2F3E7",
  border: "#D7E0F0",
  focusRing: "rgba(14, 124, 123, 0.24)",
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;

export const typography = {
  fontFamily: 'System, -apple-system, "Segoe UI", Roboto, sans-serif',
  sizes: { caption: 12, body: 16, title: 20, display: 28 },
  weights: { regular: 400, medium: 600, bold: 700 },
  minTouchTarget: 44,
  maxContentWidth: 560,
  opsContentWidth: 1120,
} as const;

export const shadow = {
  card: "0 1px 2px rgba(15, 31, 61, 0.06), 0 8px 24px rgba(15, 31, 61, 0.06)",
} as const;

export type Colors = typeof colors;
