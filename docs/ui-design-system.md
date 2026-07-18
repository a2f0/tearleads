# UI design system

The conventions that keep the app's chrome consistent across web (desktop
browser), iPad, and phone. They were previously discoverable only through
scattered code comments; this page is the single reference. File paths are
relative to the repo root.

## Two shells, three tiers

The app renders one React tree with two interchangeable shells, selected by
`packages/app/src/navigation/AppNavigationMode.ts`:

- **windowed** — the desktop window-manager UI (`components/window/*`,
  `components/pane/*`). Active at or above 1024px with a fine pointer.
- **routed** — the single-pane touch UI (`components/layout/routed/*`). Active
  below 1024px, on any coarse-pointer device, and on iPad-like environments
  (`isIPadLikeEnvironment` matches iPad UAs and Macs with touch points, so an
  iPad running a desktop-class browser still gets the touch shell).

Inside the routed shell there are two tiers, split at 760px:

- **mobile** (< 760px) — top app bar, bottom taskbar, slide-in per-app sidebar
  drawer, bottom-sheet app launcher.
- **tablet** (>= 760px) — persistent left nav rail beside the content (the iPad
  layout), same app bar and taskbar.

Breakpoint constants live in one place:
`packages/app/src/navigation/breakpoints.ts` (`MOBILE_BREAKPOINT_PX = 1024`,
`ROUTED_TABLET_BREAKPOINT_PX = 760`). CSS cannot read TS constants, so
`RoutedPane.css` mirrors the 760px line in a media query;
`packages/app/src/navigation/breakpoints.test.ts` fails if the two drift.

The switch between shells never remounts the runtime-owning subtrees — see the
comment in `components/layout/Layout.tsx`. A user can also force a mode via the
taskbar/footer switch (`NavigationModeOverrideProvider`).

## Touch sizing keys off an attribute, not a media query

`Layout` stamps `<html data-navigation-mode="routed">` whenever the routed
shell is active (`navigation/useNavigationModeDocumentAttribute.ts`). All touch
sizing hangs off that attribute — deliberately NOT `@media (pointer: coarse)`,
because an iPad with a mouse reports a fine pointer but still renders the touch
shell. Stamping the root element also lets portaled menus and modals inherit
the sizing.

Two Apple HIG rules drive the values (see the comment block in
`packages/ui/src/styles.css`):

1. **44px minimum hit target.** `--control-height` resolves to `2.75rem` under
   `data-navigation-mode="routed"` (dense desktop default is `2rem`). Every
   control primitive keys its min-height/size off this token, so meeting the
   floor is automatic for components that use the shared primitives.
   Virtualized rows go through `navigation/useTouchRowHeight.ts`
   (`TOUCH_ROW_HEIGHT = 44`), which drives both the virtualization math and the
   rendered row height so they cannot desync.
2. **16px native inputs.** `input`/`select`/`textarea` render at
   `max(16px, 1em)` in routed mode so iOS Safari does not auto-zoom the
   viewport on focus.

## Safe areas

All builds opt into `viewport-fit=cover` (`packages/app-capacitor/index.html`,
`packages/app-web/src/index.html`), so the app paints edge-to-edge on notched
devices and must pad by the cutout insets. The insets are tokenized in
`packages/ui/src/styles.css` (`--safe-area-top/right/bottom/left`, wrapping
`env(safe-area-inset-*)`; 0 everywhere else). Policy: **the chrome element that
touches a screen edge absorbs that edge's inset**:

- top — the frame header (`.tearleads-header`);
- bottom — the routed taskbar and bottom sheet (`RoutedPane.css`), and the
  frame footer when present;
- left — the tablet nav rail, or the app bar / taskbar / main content on the
  mobile tier (the rail absorbs it on tablet);
- right — the app bar, taskbar, main content, and the mobile sidebar drawer.

Vertical sizing uses `100dvh` (with a `100vh` fallback) so iOS Safari's
collapsing toolbars never hide the bottom taskbar.

On native, `packages/app-capacitor/src/statusBar.ts` syncs the status-bar style
with the theme: the header band is dark in both themes, so icons are always
light, and Android additionally paints the bar to match the header. It observes
the same `<html data-theme>` attribute the CSS keys off.

## Tokens and theming

`packages/ui/src/styles.css` is the single token sheet: color roles
(`--color-*`, `--emphasis-*`, `--tearleads-*` chrome bands), typography scale,
spacing scale (`--space-2xs` through `--space-md`), control sizing
(`--control-height`, `--control-padding-*`), row-height rhythm, borders
(`--border`, `--border-strong`), opacity scale, overlays, and motion. Rules:

- No raw hex colors, no magic pixel values in feature CSS — always the tokens.
  (The only sanctioned literals are structural one-offs like resize-handle hit
  zones, each with a comment.)
- Themes override only the color tokens, under `:root[data-theme="<id>"]`.
  The registry is `packages/app/src/theme/themes.ts`; `ThemeProvider` stamps
  `<html data-theme>`. Structural tokens are theme-independent by design.
- Each component ships a sibling `.css` file imported by its `.tsx`; class
  names are composed with `classNames` from `components/shared/classNames`.

## Component policy

The de-facto component library is `packages/app/src/components`:

- **Buttons**: use `MiniAppButton`
  (`components/mini-app/controls/MiniAppButton.tsx`) for every content-surface
  button. Variants: `ghost`, `block`, `withIcon` (icon + label row), plus the
  `.mini-app-icon-button` class for square icon-only buttons and
  `MiniAppClipboardButton` for copy affordances. Do not re-declare the button
  recipe in feature CSS; keep a feature class only for layout deltas (width,
  grid placement, media-query behavior) layered on top of the component.
  Exception: window/pane/routed chrome and the `@tearleads/ui` header
  (`.tearleads-action-button`) own their own button chrome deliberately.
- **Layout**: `MiniAppRoot` / `MiniAppHeader` / `MiniAppSection` /
  `MiniAppPanel` / `MiniAppSidebar` / `MiniAppToolbar`
  (`components/mini-app/layout/*`), modal/sheet via
  `components/mini-app/overlays/MiniAppModal.tsx`.
- **Tables, rows, virtual lists**: `components/mini-app/tables/*`, `rows/*`,
  `virtual/*`.
- **Import paths**: the canonical barrels are
  `components/mini-app/MiniAppLayout.tsx` and
  `components/mini-app/MiniAppTable.tsx`; rows and virtual are imported from
  their modules directly (`components/mini-app/rows/MiniAppRow`,
  `components/mini-app/virtual/MiniAppVirtual`). The old `components/shared/*`
  and `components/pane/*.tsx` re-export shims were removed — import `Pane`
  family components from their subdirectories (`pane/shell/Pane`, etc.).

## Per-app chrome registration

Screens never build their own top bar. Each mini-app's `*RoutedChrome.tsx`
registers title, back action, and toolbar actions into shared contexts
(`WindowMenuContext`, detail back-action hooks) that BOTH the windowed title
bar and the routed app bar read, so a screen automatically gets correct chrome
in either shell. In-body section headings use `MiniAppHeader`, which is
layered under the shell title by design.
