import type { ThemeDefinition } from "@tearleads/windowing";

// The app's color themes, in the order the footer switch cycles them. Each id
// here has a matching `:root[data-theme="<id>"]` token block in @tearleads/ui's
// styles.css (the "light" default living in the base `:root`).
//
// Adding a theme:
//   1. Add a `:root[data-theme="<id>"]` token block to @tearleads/ui — in
//      packages/ui/src/styles.css, or a companion `styles.<id>.css` imported by
//      TearleadsFrame when styles.css is at its size budget (as Dusk is).
//   2. Add its id/label/scheme to APP_THEMES below (and to the ThemeId union).
// A host profile offers these themes (see AppHostProfile.themes); the windowing
// package's provider and switch read the list, and the few surfaces that depend
// on light-vs-dark (shadow depth, status-glyph hues, the native status bar) key
// off the scheme rather than a theme id.

export type ThemeId = "light" | "dark" | "dusk";

// Cycle Dark -> Light -> Dusk. OS defaults still select Light or Dark;
// Dusk remains an explicit choice.
export const APP_THEMES: readonly ThemeDefinition<ThemeId>[] = [
  { id: "dark", label: "Dark", scheme: "dark" },
  { id: "light", label: "Light", scheme: "light" },
  { id: "dusk", label: "Dusk", scheme: "dark" },
];
