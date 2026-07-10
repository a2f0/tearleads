import { type RenderResult, render } from "@testing-library/react";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "../../src/components/pane/dual-pane";
import { Pane } from "../../src/components/pane/Pane";
import { PaneProvider } from "../../src/components/pane/PaneProvider";
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
