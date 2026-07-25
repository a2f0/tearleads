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
