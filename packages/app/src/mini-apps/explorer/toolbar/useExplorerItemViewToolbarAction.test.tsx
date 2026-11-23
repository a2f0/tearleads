import { afterEach, expect, test } from "bun:test";
import { WindowMenuProvider } from "@tearleads/windowing";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  createExplorerModel,
  ExplorerRoutedChromeHarness,
} from "../../../../test/helpers/explorerRoutedChromeTestUtils";
import { EXPLORER_ORPHANED_DOCUMENTS_ID } from "../../../stores/explorer/orphanedDocuments";
import { EXPLORER_LABELS } from "../labels";

const STORAGE_KEY = "tearleads.explorer:item-view";

afterEach(() => {
  cleanup();
  localStorage.removeItem(STORAGE_KEY);
});

function renderChrome(model = createExplorerModel()) {
  return render(
    <WindowMenuProvider>
      <ExplorerRoutedChromeHarness model={model} />
    </WindowMenuProvider>,
  );
}

test("the view switch cycles small rows, large rows, and grid, naming the next view", async () => {
  const view = renderChrome();

  // Each click moves to the view the button named, and stores it.
  const cycle = [
    [EXPLORER_LABELS.itemViewSwitchToLargeRows, "large-rows"],
    [EXPLORER_LABELS.itemViewSwitchToGrid, "grid"],
    [EXPLORER_LABELS.itemViewSwitchToRows, "rows"],
  ] as const;

  for (const [label, storedView] of cycle) {
    fireEvent.click(
      await waitFor(() => view.getByRole("button", { name: label })),
    );
    await waitFor(() =>
      expect(localStorage.getItem(STORAGE_KEY)).toBe(storedView),
    );
  }

  // Back at the dense rows, the switch offers large rows again.
  await waitFor(() =>
    expect(
      view.getByRole("button", {
        name: EXPLORER_LABELS.itemViewSwitchToLargeRows,
      }),
    ).toBeTruthy(),
  );
});

test("the view switch starts from the stored view", async () => {
  localStorage.setItem(STORAGE_KEY, "grid");
  const view = renderChrome();

  await waitFor(() =>
    expect(
      view.getByRole("button", { name: EXPLORER_LABELS.itemViewSwitchToRows }),
    ).toBeTruthy(),
  );
});

test("the Recovery collection can switch views though it has no container toolbar", async () => {
  const baseModel = createExplorerModel();
  const view = renderChrome(
    createExplorerModel({
      isActiveContactsContainer: false,
      selection: {
        ...baseModel.selection,
        activeContainerId: EXPLORER_ORPHANED_DOCUMENTS_ID,
        selectedDocument: undefined,
      },
    }),
  );

  await waitFor(() =>
    expect(
      view.getByRole("button", {
        name: EXPLORER_LABELS.itemViewSwitchToLargeRows,
      }),
    ).toBeTruthy(),
  );
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.documentInfoGetInfoAction,
    }),
  ).toBeNull();
});

test("an open document hides the view switch", async () => {
  const baseModel = createExplorerModel();
  const view = renderChrome(
    createExplorerModel({
      isActiveContactsContainer: false,
      selection: {
        ...baseModel.selection,
        activeContainerId: "folder-1",
        selectedDocument: {
          containerId: "folder-1",
          documentId: "document-1",
          id: "note-1",
          title: "Note",
          updatedAt: "2026-11-23T00:00:00.000Z",
        },
      },
    }),
  );

  await waitFor(() =>
    expect(
      view.getByRole("button", {
        name: EXPLORER_LABELS.documentInfoGetInfoAction,
      }),
    ).toBeTruthy(),
  );
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.itemViewSwitchToLargeRows,
    }),
  ).toBeNull();
});
