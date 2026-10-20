// Customer theme. Values mirror @wandary/design-tokens without importing
// native code, so web preview and tests share one source of truth.
// Follows DESIGN.md: dashboard + mobile-app template structure,
// expo / clean / minimal mood, teal as the single accent.
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
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;
export const typography = {
  sizes: { caption: 12, body: 16, title: 20, display: 28 },
} as const;
export const minTouchTarget = 44;
export const maxContentWidth = 560;
