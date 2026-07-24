import { TearleadsHeader } from "@tearleads/ui";
import { type RenderResult, render } from "@testing-library/react";
import { type PropsWithChildren, useState } from "react";
import { MobileAppTitleProvider } from "../../src/components/layout/MobileAppTitleContext";
import {
  DualPaneProvider,
  PaneSideProvider,
} from "../../src/components/pane/dual-pane";
import { PaneProvider } from "../../src/components/pane/runtime/PaneProvider";
import { Pane } from "../../src/components/pane/shell/Pane";
import { createTestHostConfig } from "./paneTestUtils";

function MobileTitleTestShell({
  children,
  withHeader,
}: PropsWithChildren<{ withHeader: boolean }>) {
  const [title, setTitle] = useState<string | null>(null);

  return (
    <>
      {withHeader && (
        <TearleadsHeader
          brandLabel={title ? `Tearleads - ${title}` : "Tearleads"}
        />
      )}
      <MobileAppTitleProvider setTitle={setTitle}>
        {children}
      </MobileAppTitleProvider>
    </>
  );
}

export function renderRoutedPane({
  withHeader = false,
}: {
  withHeader?: boolean;
} = {}): RenderResult {
  window.history.replaceState(null, "", "/");

  return render(
    <MobileTitleTestShell withHeader={withHeader}>
      <DualPaneProvider>
        <PaneSideProvider side="left">
          <PaneProvider hostConfig={createTestHostConfig()}>
            <Pane className="pane" navigationMode="routed" routedVisible />
          </PaneProvider>
        </PaneSideProvider>
      </DualPaneProvider>
    </MobileTitleTestShell>,
  );
}
