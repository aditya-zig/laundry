// Customer theme. Values mirror @laundry/design-tokens without importing
// native code, so web preview and tests share one source of truth.
export const colors = {
  surface: "#FFFFFF",
  surfaceTint: "#EEF4FF",
  ink: "#0F1F3D",
  inkMuted: "#4A5A78",
  action: "#0E7C7B",
  actionPressed: "#0A5F5E",
  danger: "#B3261E",
  warning: "#8A5A00",
  success: "#1B7A3D",
  border: "#D7E0F0",
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const minTouchTarget = 44;
export const maxContentWidth = 560;
