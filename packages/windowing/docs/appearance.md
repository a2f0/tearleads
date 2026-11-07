# Themes, Wallpapers, And Styles

Part of the [@tearleads/windowing](../README.md).

## Themes

A host offers its own color themes. `ThemeProvider` takes them as a list of
`{ id, label, scheme }`, the scheme `light` or `dark`, and stamps the active one
as `<html data-theme>` and `<html data-theme-scheme>`. The host styles each
theme with a block of the design tokens (see [Styles](#styles)):

```tsx
const THEMES: readonly ThemeDefinition<"paper" | "ink">[] = [
  { id: "paper", label: "Paper", scheme: "light" },
  { id: "ink", label: "Ink", scheme: "dark" },
];

<ThemeProvider
  defaultTheme={{ dark: "ink", light: "paper" }}
  storageKey="notes.theme"
  themes={THEMES}
>
  <Desktop />
  <ThemeSwitch />
</ThemeProvider>;
```

```css
:root[data-theme="ink"] {
  --color-dark: #e5e5e5;
  --color-light: #161616;
}
```

`defaultTheme`, the theme until the user picks one, is an id or an id per OS
color scheme, followed live. The choice persists under `storageKey`; a stored
id the host no longer offers counts as none, and a default it does not offer
falls back to its first theme. Define the list once, outside render.

`ThemeSwitch`, for a taskbar's corner, moves to the next theme in order,
wrapping, and names it ("Switch to Ink theme"). It renders nothing outside a
provider or for a single theme. It draws a half-filled square unless given an
`icon`, and is styled as `NavigationModeSwitch` unless given a `className`.
`useTheme` reads the active and next themes and the list, and sets a theme by
id; `useOptionalTheme` returns `null` outside a provider.

Mount one provider above everything themed. It stamps the attributes before
the browser paints and removes them on unmount; under a dark scheme,
[`tokens.css`][tokens] sets `color-scheme: dark`. Tearleads sets its themes per
host profile in [`packages/app/src/host/AppHostConfig.ts`][host-profile].

## Wallpapers and Display Properties

A host offers its own desktop wallpapers. A `WallpaperDefinition` is
`{ id, label, tile?, base?, ink? }`: `tile` is one cell of a repeating
pattern, as SVG markup with its `width` and `height` in CSS pixels. The tile's
SVG is a mask rather than a picture: opaque shapes paint the ink, translucent
ones (`fill-opacity`) a share of it, and the base shows elsewhere. Unless a
wallpaper names its colors, they come from the theme, resolved on the
wallpaper's own element: the `--desktop-wallpaper-base` and
`--desktop-wallpaper-ink` tokens where a host sets them, else the desk color
(`--desktop-background`, then `--color-light`) under a faint wash of
`--color-dark`. So one tile suits every theme.
A wallpaper without a tile is its base alone.

The package ships quiet tessellations to choose from: `BLOCKS_WALLPAPER`,
`HONEYCOMB_WALLPAPER`, `TRIANGLES_WALLPAPER`, `HARLEQUIN_WALLPAPER`,
`CHEVRON_WALLPAPER`, and `PLAIN_WALLPAPER` (no pattern). List them with the
host's own in a `WallpaperProvider`, and render `DesktopWallpaper` as the
first child of the desktop surface, before `DesktopIcons`:

```tsx
const BRICKS: WallpaperDefinition<"bricks"> = {
  id: "bricks",
  label: "Bricks",
  tile: {
    height: 24,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24">…</svg>`,
    width: 48,
  },
};
const WALLPAPERS = [BRICKS, HONEYCOMB_WALLPAPER, PLAIN_WALLPAPER];

<WallpaperProvider
  defaultWallpaper="bricks"
  storageKey="notes.wallpaper"
  wallpapers={WALLPAPERS}
>
  <div style={{ position: "relative", isolation: "isolate", height: "100%" }}>
    <DesktopWallpaper />
    <DesktopIcons appIds={APP_IDS} />
    {windows}
  </div>
</WallpaperProvider>;
```

The wallpaper paints on a layer below everything on the surface, including
content laid out in flow, so the surface must be a stacking context: give it
`isolation: isolate` beside its `position`. The wallpaper takes no pointer
input, so a right-click on it reaches the surface, where a host opens its
desktop menu. The choice persists under
`storageKey` like a theme's; `useWallpaper` and `useOptionalWallpaper` read
and set it. `DesktopWallpaper` paints its `wallpaper` prop instead when given
one, and nothing without a provider.

`DisplayProperties` is the content of a host's Display Properties mini-app: a
Background section listing the provider's wallpapers as previews, and a Theme
section listing the theme provider's themes. Each choice applies at once; a
section whose provider is missing, or a theme list of one, is left out. Both
Tearleads and a2f0.net open it from their desktop's context menu.

## Styles

Each component imports its own stylesheet, so a bundler that handles CSS imports
picks them up. Stylesheets are also exported by path (for example
`@tearleads/windowing/window/WindowTitleBar.css`) for surfaces that reuse the
chrome's look without rendering a window.

The stylesheets read design tokens (colors, spacing, radii, shadows, and the
`--window-bar-*` and `--tearleads-window-titlebar-*` chrome tokens). The package
entry imports [`tokens.css`][tokens], which defines every one of them under
`:where(:root)`, so a page that defines none still renders a complete light
window. That rule has zero specificity: any `:root` rule, theme, or scoped block
the host writes overrides it. Tearleads overrides them with its own themes in
[`packages/ui/src/styles.css`][ui-styles] and
[`packages/app/src/shell/layout/AppChrome.css`][app-chrome].
The routed shell also reads the screen's safe areas (`--safe-area-*`) and, under
`:root[data-navigation-mode="routed"]`, a 44px `--control-height` and 24px
`--control-icon-size`, which [`tokens.css`][tokens] defines the same way.

Several defaults derive from `--color-dark`, the foreground: the window edge
(`--border-strong-color`), the hover and selection chip (`--emphasis-surface`
and `--emphasis-text`), and `--color-hairline`. A dark theme that sets only the
`--color-*` primitives gets near-white edges and chips, so set these too, as
Tearleads' dark theme does.

The window, menus, and routed shell draw thin scrollbars in `--scrollbar-thumb`
over `--scrollbar-track`. [`tokens.css`][tokens] leaves both unset, so the thumb
falls back to `--color-dark` at 32%, mixed on each surface so it follows the theme
there, including a scoped one, and the track to transparent. They use the
standard `scrollbar-width` and
`scrollbar-color` properties, which Firefox, Chromium 121, and Safari 26.2
read; older Safari keeps its own scrollbars. Content in a window or the shell
scrolls the same way: `scrollbar-color` inherits from the surface, and
`scrollbar-width` is set on every element in it. Both rules have zero
specificity, so any host rule wins.

The window paints its background, behind its body and sidebar, with
`--window-background`. [`tokens.css`][tokens] leaves it unset, so it falls back
to `--color-light` wherever that is set, including a scoped theme. Content sets
its own window's background with `useWindowBackground`, while it is mounted;
`undefined` keeps the default. A document viewer can use it to set its page
apart from the window around it:

```tsx
useWindowBackground(`color-mix(in srgb, ${foreground} 10%, ${page})`);
```

The window rounds its corners but does not clip its content, since its resize
handles and menus reach past its edges. While no visible status bar sits below
it, the window body rounds its own bottom corners to the window's inner radius
and clips its content there, so content painted edge to edge stays inside the
border.

Windows and menus lay out `border-box`, the box model their sizes assume. Since
`box-sizing` does not inherit, a zero-specificity rule sets it on the window or
menu and everything inside, including window content; any host rule overrides
it.

[tokens]: https://github.com/a2f0/tearleads/blob/main/packages/windowing/src/tokens.css
[host-profile]: https://github.com/a2f0/tearleads/blob/main/packages/app/src/host/AppHostConfig.ts
[ui-styles]: https://github.com/a2f0/tearleads/blob/main/packages/ui/src/styles.css
[app-chrome]: https://github.com/a2f0/tearleads/blob/main/packages/app/src/shell/layout/AppChrome.css
