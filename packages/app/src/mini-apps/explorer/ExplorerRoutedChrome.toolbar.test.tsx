import { afterEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useMemo } from "react";
import {
  createExplorerModel,
  ExplorerRoutedChromeHarness,
} from "../../../test/helpers/explorerRoutedChromeTestUtils";
import {
  useWindowTitleBarAction,
  WindowMenuProvider,
} from "../../components/window/WindowMenuContext";
import { EXPLORER_ORPHANED_DOCUMENTS_ID } from "../../stores/explorer/orphanedDocuments";
import { EXPLORER_LABELS } from "./labels";

afterEach(() => cleanup());

function DocumentTypeToolbarActionProbe() {
  const action = useMemo(
    () => ({
      icon: <span aria-hidden />,
      id: "document-type-edit",
      label: "Edit",
      onClick: () => undefined,
      priority: 100,
    }),
    [],
  );
  useWindowTitleBarAction(action);
  return null;
}

test("system container toolbar hides forbidden actions instead of disabling them", async () => {
  const baseModel = createExplorerModel();
  const view = render(
    <WindowMenuProvider>
      <ExplorerRoutedChromeHarness
        model={createExplorerModel({
          activeContainerHasRules: true,
          canCreateChildInActiveContainer: false,
          canCreateStructuredDocumentInActiveContainer: false,
          canUploadToActiveContainer: false,
          isActiveContactsContainer: false,
          selection: {
            ...baseModel.selection,
            activeContainerId: "trash-container",
            selectedDocument: undefined,
          },
        })}
      />
    </WindowMenuProvider>,
  );

  await waitFor(() => {
    expect(
      view.getByRole("button", {
        name: EXPLORER_LABELS.documentInfoGetInfoAction,
      }),
    ).toBeTruthy();
  });

  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.createChildFolderAction,
    }),
  ).toBeNull();
  expect(
    view.queryByRole("button", { name: EXPLORER_LABELS.uploadAction }),
  ).toBeNull();
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.newStructuredDocumentAction,
    }),
  ).toBeNull();
});

test("recovery collection does not register container toolbar actions", async () => {
  const baseModel = createExplorerModel();
  const view = render(
    <WindowMenuProvider>
      <ExplorerRoutedChromeHarness
        model={createExplorerModel({
          isActiveContactsContainer: false,
          selection: {
            ...baseModel.selection,
            activeContainerId: EXPLORER_ORPHANED_DOCUMENTS_ID,
            selectedDocument: undefined,
          },
        })}
      />
    </WindowMenuProvider>,
  );

  await waitFor(() =>
    expect(view.getByRole("toolbar").getAttribute("aria-label")).toBe(
      "Toolbar",
    ),
  );
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.documentInfoGetInfoAction,
    }),
  ).toBeNull();
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.createChildFolderAction,
    }),
  ).toBeNull();
  expect(
    view.queryByRole("button", { name: EXPLORER_LABELS.uploadAction }),
  ).toBeNull();
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.newStructuredDocumentAction,
    }),
  ).toBeNull();
});

test("document Get Info stays second from the right beside type actions", async () => {
  const baseModel = createExplorerModel();
  const view = render(
    <WindowMenuProvider>
      <ExplorerRoutedChromeHarness
        model={createExplorerModel({
          isActiveContactsContainer: false,
          selection: {
            ...baseModel.selection,
            activeContainerId: "folder-1",
            selectedDocument: {
              containerId: "folder-1",
              documentId: "document-1",
              id: "blood-pressure-1",
              title: "Blood Pressure",
              updatedAt: "2026-07-07T00:00:00.000Z",
            },
          },
        })}
      />
      <DocumentTypeToolbarActionProbe />
    </WindowMenuProvider>,
  );

  await waitFor(() => {
    expect(view.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  expect(
    view
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual([
    EXPLORER_LABELS.documentLinkAction,
    EXPLORER_LABELS.documentMoveAction,
    "Edit",
    EXPLORER_LABELS.documentInfoGetInfoAction,
    EXPLORER_LABELS.syncSectionsAction,
  ]);
});
