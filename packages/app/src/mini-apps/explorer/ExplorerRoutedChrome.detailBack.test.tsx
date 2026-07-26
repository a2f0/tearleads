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
  selectExplorerDocument = () => undefined,
  showSelectionRoute = () => undefined,
}: {
  historyCanGoBack: boolean;
  route: ExplorerRoute;
  selectExplorerDocument?: (
    localId: string,
    containerId: string,
    options?: { replace?: boolean | undefined },
  ) => void;
  showSelectionRoute?: (options?: { replace?: boolean | undefined }) => void;
}) {
  const baseModel = createExplorerModel();
  return render(
    <WindowMenuProvider>
      <ExplorerRoutedChromeHarness
        historyCanGoBack={historyCanGoBack}
        model={createExplorerModel({
          routeState: {
            ...baseModel.routeState,
            route,
            selectExplorerDocument,
            showSelectionRoute,
          },
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
// the two alternated forever and the Explorer list was unreachable. Wherever the
// host has history — the routed shell's browser history, or a window's own Back
// stack — the chrome must leave Back alone so each press unwinds one entry.
test("document info leaves Back to host history", async () => {
  const selectedDocuments: string[] = [];
  const view = renderDetailBackChrome({
    historyCanGoBack: true,
    route: DOCUMENT_INFO_ROUTE,
    selectExplorerDocument: (localId) => {
      selectedDocuments.push(localId);
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

// The fallback REPLACES the info route rather than pushing the document on top
// of it: pushing would create the one history entry that makes Back alternate
// between the two routes forever.
test("document info with no history replaces itself with the document", async () => {
  const selectedDocuments: Array<
    [string, string, { replace?: boolean | undefined } | undefined]
  > = [];
  const view = renderDetailBackChrome({
    historyCanGoBack: false,
    route: DOCUMENT_INFO_ROUTE,
    selectExplorerDocument: (localId, containerId, options) => {
      selectedDocuments.push([localId, containerId, options]);
    },
  });

  fireEvent.click(
    await view.findByRole("button", {
      name: EXPLORER_LABELS.documentInfoBackAction,
    }),
  );

  expect(selectedDocuments).toEqual([
    ["blood-pressure-1", "folder-1", { replace: true }],
  ]);
});

// The diagnostics hub routes are route-backed too, so they stranded routed Back
// the same way: "Back to Explorer" pushed the selection route, whose Back popped
// straight back into the hub.
test("diagnostics hub leaves Back to host history", async () => {
  const returned: Array<{ replace?: boolean | undefined } | undefined> = [];
  const view = renderDetailBackChrome({
    historyCanGoBack: true,
    route: { view: "write-queue" },
    showSelectionRoute: (options) => returned.push(options),
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

test("diagnostics hub with no history replaces itself with the list", async () => {
  const returned: Array<{ replace?: boolean | undefined } | undefined> = [];
  const view = renderDetailBackChrome({
    historyCanGoBack: false,
    route: { view: "write-queue" },
    showSelectionRoute: (options) => returned.push(options),
  });

  fireEvent.click(
    await view.findByRole("button", {
      name: EXPLORER_LABELS.syncLanesBackAction,
    }),
  );

  expect(returned).toEqual([{ replace: true }]);
});
