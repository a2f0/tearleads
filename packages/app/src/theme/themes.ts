// The theme registry — the single source of truth for which color themes exist
// and the order the footer toggle cycles through them. Each id here has a
// matching `:root[data-theme="<id>"]` token block in @tearleads/ui's styles.css
// (the "light" default living in the base `:root`).
//
// Adding a theme:
//   1. Add a `:root[data-theme="<id>"]` token block in packages/ui/src/styles.css.
//   2. Add its id/label to THEMES below (and to the ThemeId union).
// Nothing else needs to change — the provider, persistence, and toggle all read
// from this list.

export type ThemeId = "light" | "dark";

export interface ThemeDefinition {
  readonly id: ThemeId;
  readonly label: string;
}

// The ordered registry. Kept module-private for now (consumed only through the
// helpers below); export it when a multi-theme picker needs to enumerate themes.
const THEMES: readonly ThemeDefinition[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export const DEFAULT_THEME_ID: ThemeId = "light";

// Concrete fallback for the (unreachable in practice) cases below where an id
// can't be resolved to a definition. THEMES always contains DEFAULT_THEME_ID.
const FALLBACK_THEME: ThemeDefinition = THEMES.find(
  (theme) => theme.id === DEFAULT_THEME_ID,
) ?? { id: DEFAULT_THEME_ID, label: "Light" };

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

export function getTheme(id: ThemeId): ThemeDefinition {
  return THEMES.find((theme) => theme.id === id) ?? FALLBACK_THEME;
}

// Advance to the next theme in registry order, wrapping around. With two themes
// this is a Light<->Dark toggle; register more themes and the same control
// cycles through every one.
export function nextThemeId(current: ThemeId): ThemeId {
  const index = THEMES.findIndex((theme) => theme.id === current);
  const next = THEMES[(index + 1) % THEMES.length];
  return next?.id ?? DEFAULT_THEME_ID;
}
