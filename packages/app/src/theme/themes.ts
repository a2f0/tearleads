// The theme registry — the single source of truth for which color themes exist
// and the order the footer toggle cycles through them. Each id here has a
// matching `:root[data-theme="<id>"]` token block in @tearleads/ui's styles.css
// (the "light" default living in the base `:root`).
//
// Adding a theme:
//   1. Add a `:root[data-theme="<id>"]` token block to @tearleads/ui — in
//      packages/ui/src/styles.css, or a companion `styles.<id>.css` imported by
//      TearleadsFrame when styles.css is at its size budget (as Dusk is).
//   2. Add its id/label/scheme to THEMES below (and to the ThemeId union).
// Nothing else needs to change — the provider, persistence, and toggle all read
// from this list, and the few surfaces that depend on light-vs-dark (shadow
// depth, status-glyph hues, the native status bar) key off the scheme rather
// than a theme id.

export type ThemeId = "light" | "dark" | "dusk";

// Whether a theme paints dark surfaces. Stamped as `<html data-theme-scheme>`
// alongside the theme id so CSS and native chrome can adapt to "a dark theme"
// without enumerating every dark theme by id.
export type ThemeScheme = "light" | "dark";

export interface ThemeDefinition {
  readonly id: ThemeId;
  readonly label: string;
  readonly scheme: ThemeScheme;
}

// The ordered registry. Kept module-private for now (consumed only through the
// helpers below); export it when a multi-theme picker needs to enumerate themes.
// The OS preference only ever resolves to Light or Dark, so those two lead and
// Dusk is an opt-in stop at the end of the cycle.
const THEMES: readonly ThemeDefinition[] = [
  { id: "light", label: "Light", scheme: "light" },
  { id: "dark", label: "Dark", scheme: "dark" },
  { id: "dusk", label: "Dusk", scheme: "dark" },
];

export const DEFAULT_THEME_ID: ThemeId = "light";

// Concrete fallback for the (unreachable in practice) cases below where an id
// can't be resolved to a definition. THEMES always contains DEFAULT_THEME_ID.
const FALLBACK_THEME: ThemeDefinition = THEMES.find(
  (theme) => theme.id === DEFAULT_THEME_ID,
) ?? { id: DEFAULT_THEME_ID, label: "Light", scheme: "light" };

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export function getTheme(id: ThemeId): ThemeDefinition {
  return THEMES.find((theme) => theme.id === id) ?? FALLBACK_THEME;
}

// Advance to the next theme in registry order, wrapping around, so the single
// footer control cycles Light -> Dark -> Dusk -> Light.
export function nextThemeId(current: ThemeId): ThemeId {
  const index = THEMES.findIndex((theme) => theme.id === current);
  const next = THEMES[(index + 1) % THEMES.length];
  return next?.id ?? DEFAULT_THEME_ID;
}
