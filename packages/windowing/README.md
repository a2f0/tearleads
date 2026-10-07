# @tearleads/windowing

App-agnostic window management for React: window state (open, focus order,
minimize/maximize, a per-window route and Back stack), window chrome (title
bar, menu bar, toolbar, sidebar, status bar, resize handles), the menu and
sidebar primitives that chrome renders with, and a taskbar's start menu.

The package knows nothing about the applications that run inside its windows.
It depends only on React, react-dom, and Phosphor icons, which draw the
chrome's own icons unless a host passes its own (see [Icons](#icons)).

## Composing a desktop

```tsx
import {
  useWindowActions,
  useWindowStateData,
  Window,
  WindowStateProvider,
} from "@tearleads/windowing";

function Desktop() {
  const { windows } = useWindowStateData();
  return (
    <div style={{ position: "relative", height: "100%" }}>
      {windows.map((entry) => (
        <Window key={entry.id} windowId={entry.id} />
      ))}
    </div>
  );
}

function OpenNotes() {
  const { create } = useWindowActions();
  return (
    <button
      type="button"
      onClick={() => create("Notes", 200, 160, NotesApp, { appId: "notes" })}
    >
      Notes
    </button>
  );
}

<WindowStateProvider>
  <OpenNotes />
  <Desktop />
</WindowStateProvider>;
```

Windows are absolutely positioned and clamp to their parent element, so the
desktop surface must be a positioned container.

## Geometry and input

Windows move by their title bar and resize by any side or corner with pointer
events, so mouse, touch, and pen all work. The resize targets reach a few
pixels past the window's border, so an edge can be taken from just outside the
window, and a hovered corner lights up over the window's own rounded border.

While a gesture runs the geometry stays local to that window; when it ends, the
window commits its `position` and `size` (surface-relative) to its
`WindowEntry`. The first layout commits too, so `position` always reflects
where the window sits. Without `size` a window takes its stylesheet's default
size.

To save a layout, read `position` and `size` from `useWindowStateData()`. To
restore one, pass them back as `create` options, which take precedence over
`create`'s viewport `x`/`y`. `setGeometry(id, { position, size })` moves or
resizes a window programmatically.

Content with a natural size, such as a document page, passes it in CSS pixels
to `useWindowContentSize({ width, height })` while it is mounted. Its window
then offers **Fit to Content** in the View menu, which restores the window if
maximized and sizes it so the scroll pane's content area shows that size. The
fit measures the chrome as rendered (bars, sidebar, the pane's padding and
scrollbars) and stays within the surface. Content the surface cannot hold
scrolls. The width always leaves room for a vertical scrollbar, so the
content keeps its width even when a status message briefly takes height from
the body. Last, the window moves as far as it must to stay on the surface.
`undefined` withdraws the item.

To open a window already fitted, pass `fitToContent: true` to `create`. The
window fits once, as Fit to Content would, when its content has loaded and
reported its size. Content reports its load by calling
`useCurrentWindow()?.markContentLoaded?.()`, for example once a page has
rendered. A later call does nothing. A window that is maximized when its
content loads, as a host might open it on a narrow screen, stays maximized,
and a window on a hidden surface fits once the surface shows.

## Slots

- **`ContentBoundary`** — `Window` renders a window's component inside this
  optional wrapper, which receives the `WindowEntry`. Hosts use it to give
  content app-specific context (a route provider, an error boundary) without the
  window layer knowing about apps. Tearleads fills it in
  `packages/app/src/mini-apps/MiniAppWindow.tsx`.
- **`appId`** — an opaque string a host attaches when creating a window. The
  window layer only stores and compares it; the host interprets it.

Windows register their own menu items, title-bar actions, a Back action, a
sidebar, a background, and a natural size through the `useWindow*` hooks, from
inside the window's content.

## Toolbar

The toolbar row sits between the menu bar and the body. Content registers icon
buttons in it with `useWindowTitleBarAction`; give an action `pressed` to make
it a toggle, announced as `aria-pressed` and drawn pressed while true:

```tsx
const icon = useMemo(() => <HashIcon aria-hidden size={18} />, []);
useWindowTitleBarAction(
  useMemo(
    () => ({ icon, id: "ascii", label: "ASCII", onClick: toggle, pressed }),
    [icon, pressed, toggle],
  ),
);
```

A window with an `appId` also offers Back through its own route history, so its
row is reserved from the start. An app that never routes passes
`historyBack={false}` to `Window`; its window then has no row until the app
first registers toolbar actions. From then on the row stays, as in any window,
so the body does not shift when actions come and go.

## Icons

Icons are components, from any icon set. `MenuItem`, `StartMenu` items, and the
chrome take a `WindowingIcon`: a component that accepts `WindowingIconProps`
(`aria-hidden`, `className`, `focusable`, and `size`), as Phosphor and Lucide
icons do. A menu item renders its icon at 16 pixels:

```tsx
import { NotePencilIcon } from "@phosphor-icons/react";

<MenuItem icon={NotePencilIcon} label="Notes" onClick={openNotes} />;
```

Toolbar actions take a rendered `icon` element instead, as shown above.

The chrome draws three icons of its own, from Phosphor: the toolbar's Back
caret and the title bar menu's Move Forward and Move Backward arrows.
`WindowingIconsProvider` replaces them for the chrome inside it. An icon it
leaves out keeps the one from the nearest provider above, or the default:

```tsx
import { ArrowDown, ArrowUp, ChevronLeft } from "lucide-react";

<WindowingIconsProvider
  icons={{ back: ChevronLeft, moveBackward: ArrowDown, moveForward: ArrowUp }}
>
  <Desktop />
</WindowingIconsProvider>;
```

## Start menu

`StartMenu` is a taskbar's start button: place it at the bar's leading edge,
give it an `icon` to show (a logo or an icon element), and the menu opens above
the button's top-left corner. Its `items` each take an `id`, `label`, optional
`icon` and `disabled`, and `onSelect`, which runs after the menu closes and
receives where the menu opened, for placing a new window near it:

```tsx
<StartMenu
  icon={<Logo />}
  items={[
    {
      icon: NotePencilIcon,
      id: "notes",
      label: "Notes",
      onSelect: ({ x }) => create("Notes", x, 80, NotesApp),
    },
  ]}
/>
```

The button is named "Menu" unless `label` says otherwise, and announces its
menu with `aria-haspopup` and `aria-expanded`. By default it is a square,
borderless control the height of the bar's controls, lit while hovered,
focused, or open (`StartMenu.css`). A `className` replaces that styling, so a
host's own button styles apply alone. A menu that needs more than a list passes
`renderMenu`, which renders the open menu itself and receives its `position`
and a `close` callback. Tearleads' footer does this in
`packages/app/src/shell/pane/footer/PaneFooter.tsx`.

## Styles

Each component imports its own stylesheet, so a bundler that handles CSS imports
picks them up. Stylesheets are also exported by path (for example
`@tearleads/windowing/window/WindowTitleBar.css`) for surfaces that reuse the
chrome's look without rendering a window.

The stylesheets read design tokens (colors, spacing, radii, shadows, and the
`--window-bar-*` and `--tearleads-window-titlebar-*` chrome tokens). The package
entry imports `tokens.css`, which defines every one of them under
`:where(:root)`, so a page that defines none still renders a complete light
window. That rule has zero specificity: any `:root` rule, theme, or scoped block
the host writes overrides it. Tearleads overrides them with its own themes in
`packages/ui/src/styles.css` and `packages/app/src/shell/layout/AppChrome.css`.

Several defaults derive from `--color-dark`, the foreground: the window edge
(`--border-strong-color`), the hover and selection chip (`--emphasis-surface`
and `--emphasis-text`), and `--color-hairline`. A dark theme that sets only the
`--color-*` primitives gets near-white edges and chips, so set these too, as
Tearleads' dark theme does.

The window paints its background, behind its body and sidebar, with
`--window-background`. `tokens.css` leaves it unset, so it falls back to
`--color-light` wherever that is set, including a scoped theme. Content sets
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

## Publishing

Inside this workspace the package exports its TypeScript source. The npm
package is built separately, into `dist/`, with its own generated manifest:

```sh
bun run --cwd packages/windowing package        # build dist/
bun run --cwd packages/windowing package:smoke  # pack, install, render, typecheck, and bundle outside the workspace
```

The built package is ES modules with declarations and source maps, plus every
stylesheet. React and react-dom are peer dependencies from 19.2, the first
release with `useEffectEvent`; Phosphor icons is its one dependency. The
stylesheets and the entry module (which imports `tokens.css`) are declared side
effects, so bundlers that trust `sideEffects` keep the token defaults.
`src/publishedPackage.test.ts` checks the built manifest and that no module
reaches outside the package, so a new workspace import fails the package's tests
rather than the publish. The declarations drop the stylesheet imports tsc keeps
in them, which a consumer's typecheck could not resolve. The smoke script
installs the lowest React the peer range admits, typechecks against the
declarations with TypeScript's defaults, and bundles a named import with webpack.

Merging to `main` publishes. When `packages/windowing` changes there,
`.github/workflows/windowing-publish.yml` publishes the version in
`package.json` if it is newer than npm's `latest`; a merge that leaves the
version alone, a re-run, or a run that finishes after a newer release succeeds
without publishing (`scripts/lib/npmPublishDecision.ts` at the repository root
makes that call). The workflow
authenticates with
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers): npm accepts
the job's GitHub OIDC token instead of an npm token, and attaches provenance to
each version. On npmjs.com the package's trusted publisher names the `a2f0`
owner, the `tearleads` repository, the `windowing-publish.yml` workflow, and
the `npm` environment, which the repository restricts to `main`. Renaming the
workflow or the environment breaks publishing until that setting matches.

To publish by hand instead, run from the repository root with an account that
owns the `@tearleads` npm scope:

```sh
npm login --registry https://registry.npmjs.org
bun run publish:npm:dry-run windowing
bun run publish:npm windowing
```

Windowing has no workspace dependencies, and its React peers and Phosphor
dependency already exist on npm, so it publishes on its own.
`scripts/publishNpmPackage.sh` publishes each npm package by its directory name;
`bun run --cwd packages/windowing publish:npm` runs it for windowing, and the
workflow runs it too.

The command rebuilds into a fresh temporary directory, publishes its generated
consumer manifest with public access to `https://registry.npmjs.org`, and
removes the directory on success or failure. A temporary `.npmrc` overrides any
scope-specific registry without changing your npm configuration. A dry run
builds and previews the same package without uploading. It accepts
`--dry-run`, `--tag <tag>` (default `latest`), and `--otp <code>`; for example:

```sh
bun run publish:npm windowing --dry-run --tag next
bun run publish:npm windowing --tag next --otp 123456
```

Run `package:smoke` separately before a release to verify the packed package in
an external consumer. It needs the network to install the consumer dependencies.

`ship-pr` bumps changed workspace packages before review and merge; the generated
manifest copies `version` from `package.json`. For a release outside that flow,
bump the version yourself before publishing. The manifest names this repository,
which npm requires of a version with provenance, and declares
`"license": "UNLICENSED"` until a license is chosen.

## Dependency maintenance

The October 2026 dependency update validates the package against React 19.3,
with npm packing and independent consumer installation. The published React
peer range remains `^19.2.0`; the window API and CSS exports require no migration.
