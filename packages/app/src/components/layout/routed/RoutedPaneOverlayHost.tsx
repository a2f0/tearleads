import { createContext, type PropsWithChildren, useContext } from "react";
import type { RoutedLayoutTier } from "../../../navigation/useRoutedLayoutTier";

interface RoutedPaneOverlayHostValue {
  /**
   * The routed shell's `<main className="routed-pane-main">` element, offered to
   * overlays that should fill the content pane rather than the viewport — the
   * routed counterpart to a window's `overlayHost` (see CurrentWindowContext).
   *
   * `null` outside the routed shell, and for the first render inside it, before
   * the pane's ref callback has handed the element back.
   */
  host: HTMLElement | null;
  /**
   * Which routed shell is on screen. An overlay that is right to confine on the
   * tablet/iPad tier — where a rail and a sidebar sit beside the pane — may
   * still want the whole screen on a phone, which has nothing beside it worth
   * keeping.
   */
  tier: RoutedLayoutTier;
}

// Defaults to no host and the narrower tier, so a component rendered outside the
// routed shell (a unit test, the windowed shell) behaves as it did before the
// pane existed rather than reaching for one that is not there.
const RoutedPaneOverlayHostContext = createContext<RoutedPaneOverlayHostValue>({
  host: null,
  tier: "mobile",
});

export function RoutedPaneOverlayHostProvider({
  children,
  value,
}: PropsWithChildren<{ value: RoutedPaneOverlayHostValue }>) {
  return (
    <RoutedPaneOverlayHostContext.Provider value={value}>
      {children}
    </RoutedPaneOverlayHostContext.Provider>
  );
}

/**
 * The routed content pane an overlay can fill, and the tier it is filling.
 *
 * Portaling into the pane — rather than into `<body>` — is what keeps a full-pane
 * overlay off the rail, the app bar, and the taskbar. The pane is not positioned,
 * so the overlays that use it pin themselves with `sticky` against its scrollport
 * (see `.mini-app-image-viewer--pane` and
 * `.note-attachment-preview-backdrop--routed`).
 */
export function useRoutedPaneOverlayHost(): RoutedPaneOverlayHostValue {
  return useContext(RoutedPaneOverlayHostContext);
}
