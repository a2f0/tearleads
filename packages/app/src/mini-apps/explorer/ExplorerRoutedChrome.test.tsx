import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  useWindowBackActionValue,
  useWindowTitleBarActions,
  WindowMenuProvider,
} from "../../components/window/WindowMenuContext";
import { useExplorerRoutedChromeActions } from "./ExplorerRoutedChrome";
import type { useExplorerModel } from "./hooks/useExplorerModel";
import { EXPLORER_LABELS } from "./labels";

afterEach(() => cleanup());

type ExplorerModel = ReturnType<typeof useExplorerModel>;

function ToolbarProbe() {
  const actions = useWindowTitleBarActions();

  return (
    <div aria-label="Toolbar" role="toolbar">
      {actions.map((action) => (
        <button
          aria-label={action.label}
          disabled={action.disabled}
          key={action.id}
          type="button"
          onClick={action.onClick}
        />
      ))}
    </div>
  );
}

function createExplorerModel(
  overrides: Partial<ExplorerModel> = {},
): ExplorerModel {
  return {
    canCreateChildInActiveContainer: true,
    canCreateContactInActiveContainer: true,
    canCreateStructuredDocumentInActiveContainer: true,
    canUploadToActiveContainer: true,
    canLinkSelectedDocument: true,
    canMoveSelectedDocument: true,
    explorer: { ready: true },
    isActiveContactsContainer: true,
    modalState: {
      openCreateChildModal: () => undefined,
      openLinkDocumentModal: () => undefined,
      openMoveDocumentModal: () => undefined,
    },
    openInlineDocument: () => undefined,
    routeState: {
      openContainerInfoRoute: () => undefined,
      openDocumentInfoRoute: () => undefined,
      openSyncLanesRoute: () => undefined,
      route: { view: "selection" },
      selectExplorerItem: () => undefined,
      showSelectionRoute: () => undefined,
    },
    selectDocumentProjection: () => undefined,
    selection: {
      activeContainerId: "contacts-container",
      selectedDocument: undefined,
    },
    ...overrides,
  } as unknown as ExplorerModel;
}

function BackProbe() {
  const backAction = useWindowBackActionValue();

  if (!backAction) {
    return null;
  }

  return (
    <button
      aria-label={backAction.label}
      disabled={backAction.disabled}
      type="button"
      onClick={backAction.onClick}
    />
  );
}

const noopOpenStructuredDocumentGrid = () => undefined;
const noopTriggerUpload = () => undefined;

function ExplorerRoutedChromeHarness({
  model,
  openStructuredDocumentGrid = noopOpenStructuredDocumentGrid,
  triggerUpload = noopTriggerUpload,
}: {
  model: ExplorerModel;
  openStructuredDocumentGrid?: () => void;
  triggerUpload?: (containerId: string) => void;
}) {
  useExplorerRoutedChromeActions({
    model,
    openStructuredDocumentGrid,
    triggerUpload,
  });

  return (
    <>
      <ToolbarProbe />
      <BackProbe />
    </>
  );
}

test("folder toolbar opens container info", async () => {
  const openedInfoContainers: string[] = [];
  const baseModel = createExplorerModel();
  const view = render(
    <WindowMenuProvider>
      <ExplorerRoutedChromeHarness
        model={createExplorerModel({
          isActiveContactsContainer: false,
          routeState: {
            ...baseModel.routeState,
            openContainerInfoRoute: (containerId) =>
              openedInfoContainers.push(containerId),
          },
          selection: {
            ...baseModel.selection,
            activeContainerId: "folder-1",
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

  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentInfoGetInfoAction,
    }),
  );

  expect(openedInfoContainers).toEqual(["folder-1"]);
});

test("contacts container toolbar offers get info and new contact", async () => {
  const createdContacts: Array<[string, string]> = [];
  const openedInfoContainers: string[] = [];
  const baseModel = createExplorerModel();
  const view = render(
    <WindowMenuProvider>
      <ExplorerRoutedChromeHarness
        model={createExplorerModel({
          openInlineDocument: (containerId, documentKind) => {
            createdContacts.push([containerId, documentKind]);
          },
          routeState: {
            ...baseModel.routeState,
            openContainerInfoRoute: (containerId) =>
              openedInfoContainers.push(containerId),
          },
        })}
      />
    </WindowMenuProvider>,
  );

  await waitFor(() => {
    expect(
      view.getByRole("button", { name: EXPLORER_LABELS.newContactAction }),
    ).toBeTruthy();
  });

  expect(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentInfoGetInfoAction,
    }),
  ).toBeTruthy();
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

  fireEvent.click(
    view.getByRole("button", { name: EXPLORER_LABELS.newContactAction }),
  );

  expect(createdContacts).toEqual([["contacts-container", "contact"]]);

  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentInfoGetInfoAction,
    }),
  );

  expect(openedInfoContainers).toEqual(["contacts-container"]);
});

test("document toolbar hides link (not greyed) when it cannot be linked", async () => {
  // The new-note case: an unsynced note (or any not-yet-linkable document)
  // omits Link entirely rather than showing it disabled, while Move — which
  // works on local-only notes — stays visible. No greyed-out button appears.
  const baseModel = createExplorerModel();
  const view = render(
    <WindowMenuProvider>
      <ExplorerRoutedChromeHarness
        model={createExplorerModel({
          canLinkSelectedDocument: false,
          isActiveContactsContainer: false,
          routeState: {
            ...baseModel.routeState,
            route: { view: "selection" },
          },
          selection: {
            ...baseModel.selection,
            activeContainerId: "folder-1",
            selectedDocument: {
              containerId: "folder-1",
              documentId: "document-1",
              id: "note-1",
              title: "Note",
              updatedAt: "2026-07-07T00:00:00.000Z",
            },
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
      name: EXPLORER_LABELS.documentLinkAction,
    }),
  ).toBeNull();
  expect(
    view.getByRole("button", { name: EXPLORER_LABELS.documentMoveAction }),
  ).toBeTruthy();
});

test("document toolbar hides move (not greyed) when it cannot be moved", async () => {
  const baseModel = createExplorerModel();
  const view = render(
    <WindowMenuProvider>
      <ExplorerRoutedChromeHarness
        model={createExplorerModel({
          canMoveSelectedDocument: false,
          isActiveContactsContainer: false,
          routeState: {
            ...baseModel.routeState,
            route: { view: "selection" },
          },
          selection: {
            ...baseModel.selection,
            activeContainerId: "contacts-container",
            selectedDocument: {
              containerId: "contacts-container",
              documentId: "contact-document-1",
              id: "contact-1",
              title: "Contact",
              updatedAt: "2026-07-07T00:00:00.000Z",
            },
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
    view.getByRole("button", { name: EXPLORER_LABELS.documentLinkAction }),
  ).toBeTruthy();
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.documentMoveAction,
    }),
  ).toBeNull();
});

// The pending-selection window: clicking a document row routes to
// "document-selection" synchronously, but selectedDocument stays undefined until
// its summary async-loads. The toolbar must still show the document's Get Info
// (sourced from the route) so the bar never empties mid-selection — the "toolbar
// collapses when selecting a contact" report.
test("document toolbar shows get info before the summary loads", async () => {
  const openedDocumentInfo: Array<[string, string]> = [];
  const baseModel = createExplorerModel();
  const view = render(
    <WindowMenuProvider>
      <ExplorerRoutedChromeHarness
        model={createExplorerModel({
          // Link/Move are unavailable during the pending window: the summary has
          // not loaded, so no targets are known yet.
          canLinkSelectedDocument: false,
          canMoveSelectedDocument: false,
          isActiveContactsContainer: false,
          routeState: {
            ...baseModel.routeState,
            route: {
              containerId: "folder-1",
              localId: "contact-1",
              view: "document-selection",
            },
            openDocumentInfoRoute: (localId, containerId) => {
              openedDocumentInfo.push([localId, containerId]);
            },
          },
          selection: {
            ...baseModel.selection,
            activeContainerId: "folder-1",
            // Summary not yet merged into documentSummaries.
            selectedDocument: undefined,
          },
        })}
      />
    </WindowMenuProvider>,
  );

  const getInfo = await view.findByRole("button", {
    name: EXPLORER_LABELS.documentInfoGetInfoAction,
  });
  // Enabled because the ids come from the route, not the unloaded summary.
  expect((getInfo as HTMLButtonElement).disabled).toBe(false);
  // Container actions are suppressed once we have routed into a document.
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.createChildFolderAction,
    }),
  ).toBeNull();
  expect(
    view.queryByRole("button", { name: EXPLORER_LABELS.newContactAction }),
  ).toBeNull();

  fireEvent.click(getInfo);

  expect(openedDocumentInfo).toEqual([["contact-1", "folder-1"]]);
});

test("document-info back action returns to the document projection", async () => {
  const selectedDocuments: Array<[string, string]> = [];
  const baseModel = createExplorerModel();
  const view = render(
    <WindowMenuProvider>
      <ExplorerRoutedChromeHarness
        model={createExplorerModel({
          routeState: {
            ...baseModel.routeState,
            route: {
              containerId: "contacts-container",
              localId: "you-contact",
              view: "document-info",
            },
          },
          selectDocumentProjection: (localId, containerId) => {
            selectedDocuments.push([localId, containerId]);
          },
        })}
      />
    </WindowMenuProvider>,
  );

  await waitFor(() => {
    expect(
      view.getByRole("button", {
        name: EXPLORER_LABELS.documentInfoBackAction,
      }),
    ).toBeTruthy();
  });

  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentInfoBackAction,
    }),
  );

  expect(selectedDocuments).toEqual([["you-contact", "contacts-container"]]);
});
