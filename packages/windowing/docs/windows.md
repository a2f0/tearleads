# Windows And Chrome

Part of the [@tearleads/windowing](../README.md).

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
  window layer knowing about apps. `MiniAppWindow` fills it for launcher apps
  (see [Launching mini-apps](./launcher.md#launching-mini-apps)).
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

Memoized `buttonProps` forwards `ref`, `aria-expanded`, and `onMouseDown` to
popup triggers. Both toolbars place Refresh last; it also remains in View.
While a `useWindowRefreshMenuItem` registration reports `refreshing`, Refresh is
disabled, announced as `aria-busy`, and shows a turning ring instead of its icon.

Windows with an `appId` reserve the toolbar and offer route-history Back.
With `historyBack={false}`, the row appears when actions register, then stays.

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
