import { type ReactNode, useMemo, useState } from "react";
import { useLauncherNavigationState } from "../launcher/LauncherNavigationProvider";
import type { MiniAppBoundary } from "../launcher/MiniAppWindow";
import type { RoutedLayoutTier } from "../launcher/useRoutedLayoutTier";
import { RoutedPaneOverlayHostProvider } from "./RoutedPaneOverlayHost";

/**
 * The routed shell's content pane: the host's top content, then the active
 * mini-app inside the host's boundary. It offers itself to overlays that fill
 * the content pane instead of the screen, so they leave the rail, app bar, and
 * taskbar on screen beside them.
 */
export function RoutedPaneMain({
  activeAppId,
  AppBoundary,
  contentTop,
  tier,
}: {
  activeAppId: string;
  AppBoundary: MiniAppBoundary;
  contentTop: ReactNode;
  tier: RoutedLayoutTier;
}) {
  const { definition } = useLauncherNavigationState();
  const ActiveMiniApp = useMemo(
    () => definition.apps[activeAppId]?.createComponent() ?? null,
    [activeAppId, definition],
  );
  // Held in state rather than a ref so the overlays that portal into the pane
  // re-render once it is on screen. The ref callback runs in the commit phase
  // and this update flushes before paint, so the pane is already the host by the
  // first frame any overlay inside it can be opened on.
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null);
  const overlayHostValue = useMemo(
    () => ({ host: overlayHost, tier }),
    [overlayHost, tier],
  );

  // Programmatically focusable (`tabIndex={-1}`, so never in the tab order),
  // like a window's content pane: an overlay that covered it lands focus here
  // when whatever opened the overlay is gone by the time it closes. Passing the
  // setter itself as the ref keeps its identity stable across renders — an
  // inline callback would detach and reattach the host on every one.
  return (
    <main className="routed-pane-main" ref={setOverlayHost} tabIndex={-1}>
      <RoutedPaneOverlayHostProvider value={overlayHostValue}>
        {contentTop}
        {ActiveMiniApp && (
          <AppBoundary appId={activeAppId}>
            <ActiveMiniApp />
          </AppBoundary>
        )}
      </RoutedPaneOverlayHostProvider>
    </main>
  );
}
