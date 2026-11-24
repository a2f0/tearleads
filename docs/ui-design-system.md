# UI design system

Conventions that keep the app's chrome consistent across web (desktop browser),
iPad, and phone. Full paths are relative to the repository root; short paths
such as [`shell/`](../packages/app/src/shell/) and
[`components/`](../packages/app/src/components/) are relative to
[`packages/app/src`](../packages/app/src/).

## Two shells, three tiers

The app renders one React tree with two interchangeable shells, selected by
`@tearleads/windowing`'s navigation mode
([`packages/windowing/src/launcher/navigationMode.ts`](../packages/windowing/src/launcher/navigationMode.ts))
from the host profile's `preferredNavigationMode`:

- **windowed** — the desktop window-manager UI (`@tearleads/windowing`,
  [`shell/pane/`](../packages/app/src/shell/pane/)). Available through the
  lower-right layout switch.
- **routed** — the single-pane UI: `@tearleads/windowing`'s routed shell
  ([`packages/windowing/src/routed/`](../packages/windowing/src/routed/))
  dressed with the app's chrome in
  [`shell/layout/routed/AppRoutedPane.tsx`](../packages/app/src/shell/layout/routed/AppRoutedPane.tsx).
  The default on desktop, iPad, and phone. The two-peer demo prefers windowed,
  keeping its split on wide desktop screens.

Inside the routed shell there are two tiers, split at 760px:

- **mobile** (< 760px) — top app bar, bottom taskbar, slide-in per-app sidebar
  drawer, bottom-sheet app launcher.
- **tablet** (>= 760px) — an app bar and taskbar with a launcher that opens in
  the left rail by default. The app bar control can move that launcher to a
  bottom sheet, freeing the rail's width for content.

The tablet breakpoint lives in
[`packages/windowing/src/launcher/breakpoints.ts`](../packages/windowing/src/launcher/breakpoints.ts)
(`ROUTED_TABLET_BREAKPOINT_PX = 760`). CSS cannot read TS constants, so
[`RoutedPane.css`](../packages/windowing/src/routed/RoutedPane.css) mirrors the
760px line in a media query;
[`packages/windowing/src/routed/breakpoints.test.ts`](../packages/windowing/src/routed/breakpoints.test.ts)
fails if the two drift.

Switching shells never remounts the runtime-owning subtrees (see the comment in
[`shell/layout/Layout.tsx`](../packages/app/src/shell/layout/Layout.tsx)). Users
can also switch shells via the taskbar/footer control
(`NavigationModeOverrideProvider`). The choice survives reloads; a saved
windowed choice yields to routed mode on narrow or touch screens.

## Touch sizing keys off an attribute, not a media query

`Layout` stamps `<html data-navigation-mode="routed">` whenever the routed shell
is active (`useNavigationModeDocumentAttribute` from `@tearleads/windowing`).
All touch sizing keys off that attribute — deliberately NOT
`@media (pointer: coarse)`, because an iPad with a mouse reports a fine pointer
but still renders the touch shell. The routed shell is also the desktop default,
so mouse users get these sizes until they choose windowed mode. Stamping the
root element also lets portaled menus and modals inherit the sizing.

Three Apple HIG rules drive the values (see the comment block in
[`packages/ui/src/styles.routed.css`](../packages/ui/src/styles.routed.css),
which holds every routed-mode override):

1. **44px minimum hit target.** `--control-height` resolves to `2.75rem` under
   `data-navigation-mode="routed"` (dense desktop default is `2rem`). Every
   control primitive keys its min-height/size off this token, so components
   using the shared primitives meet the floor automatically. Virtualized rows go
   through
   [`navigation/useTouchRowHeight.ts`](../packages/app/src/navigation/useTouchRowHeight.ts)
   (`TOUCH_ROW_HEIGHT = 44`), which drives both the virtualization math and the
   rendered row height so they cannot desync.
2. **16px native inputs.** `input`/`select`/`textarea` render at
   `max(16px, 1em)` in routed mode so iOS Safari does not auto-zoom the
   viewport on focus.
3. **Readable body text.** The type ramp is re-anchored so body text meets the
   same 16px floor and keeps pace with the enlarged touch chrome.

## Safe areas

All builds opt into `viewport-fit=cover`
([`packages/app-capacitor/index.html`](../packages/app-capacitor/index.html),
[`packages/app-web/src/index.html`](../packages/app-web/src/index.html)), so the
app paints edge-to-edge on notched devices and must pad by the cutout insets.
The insets are tokenized in
[`packages/ui/src/styles.css`](../packages/ui/src/styles.css)
(`--safe-area-top/right/bottom/left`, wrapping `env(safe-area-inset-*)`; 0
everywhere else). Policy: **the chrome element that touches a screen edge
absorbs that edge's inset**:

- top — the frame header (`.tearleads-header`);
- bottom — the routed taskbar and bottom sheet
  ([`RoutedPane.css`](../packages/windowing/src/routed/RoutedPane.css)), and the
  frame footer when present;
- left — the tablet nav rail in side mode; the app bar, taskbar, main content,
  and sidebar in tablet bottom mode or on mobile;
- right — the app bar, taskbar, main content, and the mobile sidebar drawer.

Vertical sizing uses `100dvh` (with a `100vh` fallback) so iOS Safari's
collapsing toolbars never hide the bottom taskbar.

On native,
[`packages/app-capacitor/src/device/statusBar.ts`](../packages/app-capacitor/src/device/statusBar.ts)
syncs the status-bar style with the theme: it keys the icon style off `<html
data-theme-scheme>` (dark icons over a light theme, light icons over a dark
one), and Android additionally paints the bar with the resolved `--color-muted`
app-bar color, so every theme matches without being listed there.

## Tokens and theming

[`packages/ui/src/styles.css`](../packages/ui/src/styles.css) is the single
token sheet: color roles (`--color-*`, `--emphasis-*`, `--tearleads-*` chrome
bands), typography scale, spacing scale (`--space-2xs` through `--space-md`),
control sizing (`--control-height`, `--control-padding-*`, `--form-measure`),
row-height rhythm, borders (`--border`, `--border-strong`), opacity scale,
overlays, and motion. Rules:

- No raw hex colors, no magic pixel values in feature CSS — always the tokens.
  (The only sanctioned literals are structural one-offs like resize-handle hit
  zones, each with a comment.)
- Themes override only the color tokens, under `:root[data-theme="<id>"]`. The
  registry is
  [`packages/app/src/theme/themes.ts`](../packages/app/src/theme/themes.ts)
  (Dark, Light, and Dusk, in switcher cycle order; Dusk's block lives in the
  companion [`styles.dusk.css`](../packages/ui/src/styles.dusk.css)), which each
  host profile offers; the windowing package's `ThemeProvider` stamps
  `<html data-theme>` and `<html data-theme-scheme>` (`light` | `dark`). A rule
  that only cares whether surfaces are dark keys off the scheme, never a theme
  id. The scheme also sets `color-scheme`, at attribute specificity in the
  windowing package's [`tokens.css`](../packages/windowing/src/tokens.css), so
  a third-party `:root { color-scheme: light dark }` (pdf.js ships one) cannot
  draw native controls dark under a light theme on a dark-mode OS. Structural
  tokens are theme-independent by design. Dusk uses slate-blue
  surfaces, ivory text, and muted blue emphasis; it has no decorative text
  effects.
- Each component ships a sibling `.css` file imported by its `.tsx`; class names
  are composed with `classNames` from
  [`components/shared/classNames`](../packages/app/src/components/shared/classNames.ts).

Honeycomb is the default desktop wallpaper. Settings changes the
app-wide wallpaper choice; saved choices, including None, survive reloads and
take precedence over the default.

App-specific chrome refinements live in
[`shell/layout/AppChrome.css`](../packages/app/src/shell/layout/AppChrome.css),
scoped to the navigation attribute on the root so portaled menus inherit them
without changing website chrome. The `--app-*` tokens define control/surface
radii, hover fill, control borders, and overlay/window shadows. Table rules and
shell separators use hairlines without weakening the borders of other controls.
Keyboard focus uses an inset ring so scrolling toolbars do not clip it, and
reduced-motion preferences disable chrome transitions, including the launcher.
A text editor that fills its pane, such as the note body, renders through
`MiniAppEditor`, which draws that ring in `--app-editor-focus-ring`: a
theme-derived tone at the 3:1 non-text contrast floor rather than the text
color, so the frame stays visible without glaring while the user types.

Floating windows have named, 28px minimum title-bar controls and truncate long
titles before the control cluster. The taskbar marks the frontmost visible
window with a filled, underlined chip. Shared popover menus focus the first
enabled action, support arrow keys and Home/End, and restore focus on Escape or
selection. Tab dismisses the menu and continues from its trigger.
Portaled comboboxes opt out of menu keyboard handling; their existing
`aria-activedescendant` controller keeps focus on the trigger.
Title bars deliberately grow to fit their interactive controls; informational
status bars retain the compact bar height and follow the window's bottom corners.

## Form measure

Text-entry controls are capped, content is not. A field stretched across a
maximized desktop window or an iPad reads as a long empty rule and strands a
left-aligned label a screen away from the caret, so `--form-measure` (34rem)
caps a column of entry controls.

- `.mini-app-field` carries the cap, so every `MiniAppField`, including any new
  form, gets it without opting in. The cap sits on the field, not the control,
  so the label and any trailing affordance (clipboard button) stay grouped with
  the input. `.mini-app-toolbar`'s inputs and selects still grow into their
  slack but stop at the same measure.
- A surface that **groups** fields caps the group too (`.backup-restore-main`,
  `.identity-manager-pin-forms`, `.identity-manager-recovery-key-form`,
  `.contact-document-fields`, `.contacts-detail-panel`). Otherwise the panel
  border and section heading keep spanning the whole viewport around a column
  of measure-width inputs, which reads worse than stretched fields. It also
  catches the read-mode rows that `MiniAppField` never wraps — a contact's value
  and its clipboard button are only adjacent if their row is capped. A tab strip
  is the exception: it is chrome, so it spans the surface in every tier (see
  [Tab strips](#tab-strips)) while the column below it keeps the measure.
- **The mobile tier opts out.**
  [`RoutedPane.css`](../packages/windowing/src/routed/RoutedPane.css)
  re-declares `--form-measure: 100%` under `.routed-pane--mobile`, so nothing in
  that shell is capped below 760px. The tier is single-column and deliberately
  edge-to-edge, and it runs to 759px, well past 34rem, so a cap there would
  leave the pane empty beside the column
  ([`e2e/form-measure.spec.ts`](../packages/app-web/e2e/form-measure.spec.ts)
  asserts this). Override the token, never the individual rules: `100%` and
  not `none` because consumers also read it inside `min()`, where a keyword
  invalidates the whole declaration. The release covers the shell subtree, so
  portaled menus and modals keep the cap on this tier — fine while they stay
  under the measure (`--modal-width` is 22rem).
- 34rem matches the windowed `min-width` floors those apps already declare, so a
  form fills its narrowest window exactly and simply stops growing past it.
- The unit is deliberately `rem`, and `rem` is **not** the same pixel value in
  both shells: the windowed layout inherits the monospace default-fixed-font
  quirk (`1rem` ≈ 13px), while the routed tier anchors `font-size: 16px` (see
  the block comment in
  [`styles.routed.css`](../packages/ui/src/styles.routed.css)). The cap lands at
  ~442px windowed and 544px routed: the same *character* count, which is what a
  measure should hold constant in a monospace UI. Do not "fix" this by switching
  to `px`.
- Form columns stay **left-aligned**; the slack goes to the right. Do not cap
  what wants the width — tables, virtualized lists, document editors
  (`NoteDocument`, `EnvFile`, `JsonFileDocument`), and media previews.
- Two other standard answers are already used where they fit better: reflow
  into as many columns as fit (`.file-document-metadata`,
  `.identity-manager-pin-forms`), and size a control to its content
  (`.explorer-container-icon-picker`).

## Tab strips

`MiniAppTabList`
([`components/mini-app/layout/MiniAppTabs.tsx`](../packages/app/src/components/mini-app/layout/MiniAppTabs.tsx))
draws every tab strip, and a strip is chrome, not content: in every tier it
spans its surface edge to edge (the phone screen, the tablet pane beside the
rail, or the window's sides) while the panel below keeps the content inset.
The strip's look and its layout rules both live in
[`MiniAppTabs.css`](../packages/app/src/components/mini-app/layout/MiniAppTabs.css);
a surface's own CSS keeps only its layout around the strip and the panel.

- Tabs round their top corners only. Their bottom edge sits on the strip's
  baseline, and the selected tab's panel-colored bottom border opens it into
  the panel below.
- The strip cancels `--mini-app-edge-inset`, which `MiniAppRoot` publishes as
  its own padding plus the window body's `--window-content-inset`, so one rule
  holds in a window, a routed pane, and a root with no padding. A strip outside
  any root, as in Settings, cancels only the window's padding.
- Pass `leading` when the strip is the first thing on its surface (Settings,
  System Monitor, the Explorer sections hub). It then also sits flush under the
  app bar or window toolbar. A strip below a heading, as in Get Info or
  Backup/Restore, keeps its place in the flow.
- A negative margin cannot escape a scrollport, so a scrolling panel that holds
  a strip, or a list running to the edges, takes over the inset as padding.
  `MiniAppPanel scroll` gets this automatically; any other scroll container
  that holds one, such as Org Manager's main region, adds the
  `mini-app-edge-scrollport` class. A strip nested inside further inline
  padding, such as a framed panel, needs its own rule.
- [`e2e/tab-strip-bleed.spec.ts`](../packages/app-web/e2e/tab-strip-bleed.spec.ts)
  asserts the painted edges in every tier.

## List tables

A list a mini-app shows as a view's content (Explorer's item list and
diagnostics lists, Shared with Me, Org Manager's roster, groups, and grants,
Identity Manager's sessions, Root's section lists) runs to the edges of its
surface the way a tab strip does, through the shared
`mini-app-table-frame--edges` modifier
([`MiniAppTableEdges.css`](../packages/app/src/components/mini-app/tables/MiniAppTableEdges.css)):

- The column headings, the rule above them, and every row's line and highlight
  reach both sides of the window's content pane or the routed pane. The text
  and kebabs keep the content's inset. On a phone the list also takes
  `mini-app-table-frame--bleed`, which sets its text nearer the screen edge.
- A table inside an info or detail view, such as Get Info or a group's links,
  keeps its inset.
- A list with nothing above it in its mini-app, as in Shared with Me, sits
  directly under the app bar or window toolbar. In the routed shell it drops
  its own top rule, because the app bar already draws one.
- A list inside a region that scrolls on its own needs that region to take over
  the inset, as a tab strip does (see the scrollport rule above).
- [`e2e/mini-app-list-edges.spec.ts`](../packages/app-web/e2e/mini-app-list-edges.spec.ts)
  asserts the painted edges in every tier, and
  [`e2e/shared-with-me-table.spec.ts`](../packages/app-web/e2e/shared-with-me-table.spec.ts)
  asserts the flush leading list.

## Component policy

The de-facto component library is [`packages/app/src/components`](../packages/app/src/components/):

- **Buttons**: use `MiniAppButton`
  ([`components/mini-app/controls/MiniAppButton.tsx`](../packages/app/src/components/mini-app/controls/MiniAppButton.tsx))
  for every content-surface button. It takes a `default`, `danger`, or `ghost`
  variant and the `block` and `withIcon` (icon + label row) props; use the
  `.mini-app-icon-button` class for square icon-only buttons and
  `MiniAppClipboardButton` for copy affordances. Do not re-declare the button
  recipe in feature CSS; keep a feature class only for layout deltas (width,
  grid placement, media-query behavior) layered on top of the component.
  Exception: window/pane/routed chrome and the `@tearleads/ui` header
  (`.tearleads-action-button`) own their own button chrome deliberately.
- **Action menus**: a set of actions that reads as a menu, one per line, uses
  `MiniAppRowButton` rows in a labelled list instead of framed buttons. Each row
  is a glyph and a short visible label, borderless until hover (the window
  toolbar's highlight), at least the control height, with the glyph at
  `--control-icon-size` and never below 20px. Give each row an accessible name
  that starts with its visible label and adds the context it leaves out. See
  the recovery key actions
  ([`components/identity/recovery-key/RecoveryKeyDisplay.tsx`](../packages/app/src/components/identity/recovery-key/RecoveryKeyDisplay.tsx)).
- **Layout**: `MiniAppRoot` / `MiniAppHeader` / `MiniAppSection` /
  `MiniAppPanel` / `MiniAppSidebar` / `MiniAppToolbar`
  ([`components/mini-app/layout/`](../packages/app/src/components/mini-app/layout/)),
  modal/sheet via
  [`components/mini-app/overlays/MiniAppModal.tsx`](../packages/app/src/components/mini-app/overlays/MiniAppModal.tsx).
  Set a runtime value in modal copy (the phrase a confirmation asks the user
  to type, or the name of what the action changes) in `MiniAppModalHighlight`,
  not `<strong>`: `:root` sets `font-synthesis: none`, so weight alone renders
  as regular text wherever the monospace face ships no bold, as on Android.
- **Checkboxes**: use `MiniAppCheckbox`
  ([`components/mini-app/controls/MiniAppCheckbox.tsx`](../packages/app/src/components/mini-app/controls/MiniAppCheckbox.tsx))
  with a clickable label. It owns the bordered square, checked fill and
  checkmark, keyboard focus, disabled styling, and native forced-colors
  appearance. Keep feature CSS to label layout; in the routed shell the label
  must provide a `--control-height` minimum tap target. Feature-flag switches
  use the same control with `role="switch"`.
- **Tables, rows, virtual lists**:
  [`components/mini-app/tables/`](../packages/app/src/components/mini-app/tables/),
  [`rows/`](../packages/app/src/components/mini-app/rows/),
  [`virtual/`](../packages/app/src/components/mini-app/virtual/).
- **Import paths**: the canonical barrels are
  [`components/mini-app/MiniAppLayout.tsx`](../packages/app/src/components/mini-app/MiniAppLayout.tsx)
  and
  [`components/mini-app/MiniAppTable.tsx`](../packages/app/src/components/mini-app/MiniAppTable.tsx);
  rows and virtual are imported from their modules directly
  ([`components/mini-app/rows/MiniAppRow`](../packages/app/src/components/mini-app/rows/MiniAppRow.tsx),
  [`components/mini-app/virtual/MiniAppVirtual`](../packages/app/src/components/mini-app/virtual/MiniAppVirtual.tsx)).
  Import `Pane` family components from their
  [`shell/pane/`](../packages/app/src/shell/pane/) subdirectories
  ([`shell/pane/shell/Pane`](../packages/app/src/shell/pane/shell/Pane.tsx),
  etc.).

## Per-app chrome registration

Screens never build their own top bar. Each mini-app registers its toolbar and
Back actions through `@tearleads/windowing`'s window hooks
(`useWindowTitleBarAction`, `useWindowBackAction`, and related hooks in
[`packages/windowing/src/window/WindowMenuContext.tsx`](../packages/windowing/src/window/WindowMenuContext.tsx)),
usually from its `*RoutedChrome.tsx` (such as
[`ExplorerRoutedChrome.tsx`](../packages/app/src/mini-apps/explorer/ExplorerRoutedChrome.tsx)).
BOTH the windowed title bar and the routed app bar read those registrations, so
a screen gets correct chrome in either shell. In-body section headings use
`MiniAppHeader`, which is layered under the shell title by design.
