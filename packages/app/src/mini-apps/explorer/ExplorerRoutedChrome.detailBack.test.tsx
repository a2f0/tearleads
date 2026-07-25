import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  createExplorerModel,
  ExplorerRoutedChromeHarness,
} from "../../../test/helpers/explorerRoutedChromeTestUtils";
import { WindowMenuProvider } from "../../components/window/WindowMenuContext";
import { EXPLORER_LABELS } from "./labels";
import type { ExplorerRoute } from "./routes";

afterEach(() => cleanup());

function renderDetailBackChrome({
  historyCanGoBack,
  route,
  selectDocumentProjection = () => undefined,
  showSelectionRoute = () => undefined,
}: {
  historyCanGoBack: boolean;
  route: ExplorerRoute;
  selectDocumentProjection?: (localId: string, containerId: string) => void;
  showSelectionRoute?: () => void;
}) {
  const baseModel = createExplorerModel();
  return render(
    <WindowMenuProvider>
      <ExplorerRoutedChromeHarness
        historyCanGoBack={historyCanGoBack}
        navigationMode="routed"
        model={createExplorerModel({
          routeState: {
            ...baseModel.routeState,
            route,
            showSelectionRoute,
          },
          selectDocumentProjection,
        })}
      />
    </WindowMenuProvider>,
  );
}

const DOCUMENT_INFO_ROUTE: ExplorerRoute = {
  containerId: "folder-1",
  localId: "blood-pressure-1",
  view: "document-info",
};

// The reported mobile bug: from Explorer -> document -> Get Info, Back pushed
// the document route on top of the info route instead of popping it. The
// document route registers no override, so its Back popped to Get Info again —
// the two alternated forever and the Explorer list was unreachable. Routed
// chrome must leave Back to app history so each press unwinds one entry.
test("routed document info leaves Back to app history", async () => {
  const selectedDocuments: Array<[string, string]> = [];
  const view = renderDetailBackChrome({
    historyCanGoBack: true,
    route: DOCUMENT_INFO_ROUTE,
    selectDocumentProjection: (localId, containerId) => {
      selectedDocuments.push([localId, containerId]);
    },
  });

  // The persistent Sync action proves the chrome registered; only Back is absent.
  await waitFor(() => {
    expect(
      view.getByRole("button", { name: EXPLORER_LABELS.syncSectionsAction }),
    ).toBeTruthy();
  });

  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.documentInfoBackAction,
    }),
  ).toBeNull();
  expect(selectedDocuments).toEqual([]);
});

test("routed deep-linked document info gets a Back fallback", async () => {
  const selectedDocuments: Array<[string, string]> = [];
  const view = renderDetailBackChrome({
    historyCanGoBack: false,
    route: DOCUMENT_INFO_ROUTE,
    selectDocumentProjection: (localId, containerId) => {
      selectedDocuments.push([localId, containerId]);
    },
  });

  fireEvent.click(
    await view.findByRole("button", {
      name: EXPLORER_LABELS.documentInfoBackAction,
    }),
  );

  expect(selectedDocuments).toEqual([["blood-pressure-1", "folder-1"]]);
});

// The diagnostics hub routes are route-backed too, so they stranded routed Back
// the same way: "Back to Explorer" pushed the selection route, whose Back popped
// straight back into the hub.
test("routed diagnostics hub leaves Back to app history", async () => {
  const returned: number[] = [];
  const view = renderDetailBackChrome({
    historyCanGoBack: true,
    route: { view: "write-queue" },
    showSelectionRoute: () => returned.push(1),
  });

  await waitFor(() => {
    expect(
      view.getByRole("button", { name: EXPLORER_LABELS.syncSectionsAction }),
    ).toBeTruthy();
  });

  expect(
    view.queryByRole("button", { name: EXPLORER_LABELS.syncLanesBackAction }),
  ).toBeNull();
  expect(returned).toEqual([]);
});

test("routed deep-linked diagnostics hub gets a Back fallback", async () => {
  const returned: number[] = [];
  const view = renderDetailBackChrome({
    historyCanGoBack: false,
    route: { view: "write-queue" },
    showSelectionRoute: () => returned.push(1),
  });

  fireEvent.click(
    await view.findByRole("button", {
      name: EXPLORER_LABELS.syncLanesBackAction,
    }),
  );

  expect(returned).toEqual([1]);
});
