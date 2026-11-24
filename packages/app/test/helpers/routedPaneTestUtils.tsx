import { type RenderResult, render } from "@testing-library/react";
import type { AppHostConfig } from "../../src/host/AppHostConfig";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "../../src/shell/pane/dual-pane";
import { PaneProvider } from "../../src/shell/pane/runtime/PaneProvider";
import { Pane } from "../../src/shell/pane/shell/Pane";
import { AppLayoutTestProviders } from "./appLayoutTestProviders";
import { createTestHostConfig } from "./paneTestUtils";

export function renderRoutedPane(
  hostConfig: AppHostConfig = createTestHostConfig(),
): RenderResult {
  window.history.replaceState(null, "", "/");

  return render(
    <AppLayoutTestProviders>
      <DualPaneProvider>
        <PaneSideProvider side="left">
          <PaneProvider hostConfig={hostConfig}>
            <Pane className="pane" navigationMode="routed" routedVisible />
          </PaneProvider>
        </PaneSideProvider>
      </DualPaneProvider>
    </AppLayoutTestProviders>,
  );
}

// Forces the routed layout tier by stubbing matchMedia: mobile matches no
// query; tablet matches min-width queries. Returns a restore function.
export function forceMobileRoutedTier(): () => void {
  return forceRoutedTier(() => false);
}

export function forceTabletRoutedTier(): () => void {
  return forceRoutedTier((query) => query.includes("min-width"));
}

function forceRoutedTier(matches: (query: string) => boolean): () => void {
  const originalMatchMedia = window.matchMedia;

  window.matchMedia = ((query: string) => ({
    addEventListener: () => {},
    addListener: () => {},
    dispatchEvent: () => false,
    matches: matches(query),
    media: query,
    onchange: null,
    removeEventListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;

  return () => {
    window.matchMedia = originalMatchMedia;
  };
}
