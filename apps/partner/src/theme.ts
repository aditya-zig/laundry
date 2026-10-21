// Partner app design tokens. Navy/teal palette with 44px minimum touch targets.
// Values mirror @laundry/design-tokens.

export const colors = {
  surface: "#FFFFFF",
  surfaceTint: "#EEF4FF",
  surfaceCard: "#F8FAFC",
  ink: "#0F1F3D",
  inkMuted: "#4A5A78",
  action: "#0E7C7B",
  actionPressed: "#0A5F5E",
  danger: "#B3261E",
  warning: "#8A5A00",
  success: "#1B7A3D",
  border: "#D7E0F0",
  disabled: "#94A3B8",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

export const typography = {
  fontFamily: "System",
  sizes: {
    caption: 12,
    body: 16,
    title: 20,
    display: 28,
  },
} as const;

export const minTouchTarget = 44;
export const maxContentWidth = 560;
