/**
 * زادم — design tokens (single source of truth).
 *
 * The visual language: calm, premium, trustworthy Saudi retail.
 * A warm near-white base, ink-dark text, and one confident accent —
 * a deep "نخيل" (date-palm) green that reads as considered, not loud.
 *
 * Color VALUES live in app/globals.css as CSS variables so they can be
 * swapped in one place later. This file documents the scale and exposes
 * the non-color tokens (spacing, radii, type) that TS/TSX reads from.
 */

export const tokens = {
  /** Names map 1:1 to the CSS variables defined in globals.css. */
  color: {
    background: "var(--background)",
    foreground: "var(--foreground)",
    card: "var(--card)",
    cardForeground: "var(--card-foreground)",
    muted: "var(--muted)",
    mutedForeground: "var(--muted-foreground)",
    border: "var(--border)",
    /** The single confident accent. */
    brand: "var(--primary)",
    brandForeground: "var(--primary-foreground)",
    accent: "var(--accent)",
    accentForeground: "var(--accent-foreground)",
    destructive: "var(--destructive)",
    /** Financial "good" tone for confirmed totals. */
    success: "var(--success)",
  },

  /** rem-based spacing scale (mirrors the Tailwind scale we use). */
  space: {
    xs: "0.25rem",
    sm: "0.5rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
    "2xl": "3rem",
    "3xl": "4rem",
  },

  radius: {
    sm: "calc(var(--radius) * 0.6)",
    md: "calc(var(--radius) * 0.85)",
    lg: "var(--radius)",
    xl: "calc(var(--radius) * 1.5)",
    full: "9999px",
  },

  /** Type scale, mobile-first. Line-heights tuned for Arabic readability. */
  type: {
    display: { size: "clamp(1.9rem, 6vw, 3rem)", leading: "1.2", weight: 700 },
    h1: { size: "clamp(1.5rem, 4.5vw, 2.1rem)", leading: "1.25", weight: 700 },
    h2: { size: "clamp(1.25rem, 3.5vw, 1.6rem)", leading: "1.3", weight: 600 },
    h3: { size: "1.125rem", leading: "1.4", weight: 600 },
    body: { size: "1rem", leading: "1.6", weight: 400 },
    small: { size: "0.875rem", leading: "1.5", weight: 400 },
  },

  /** Shared content max width for the storefront shell. */
  container: "80rem",
} as const

export type Tokens = typeof tokens
