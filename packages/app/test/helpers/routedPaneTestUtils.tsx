import { type RenderResult, render } from "@testing-library/react";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "../../src/components/pane/dual-pane";
import { PaneProvider } from "../../src/components/pane/runtime/PaneProvider";
import { Pane } from "../../src/components/pane/shell/Pane";
import { createTestHostConfig } from "./paneTestUtils";

export function renderRoutedPane(): RenderResult {
  window.history.replaceState(null, "", "/");

  return render(
    <DualPaneProvider>
      <PaneSideProvider side="left">
        <PaneProvider hostConfig={createTestHostConfig()}>
          <Pane className="pane" navigationMode="routed" routedVisible />
        </PaneProvider>
      </PaneSideProvider>
    </DualPaneProvider>,
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
