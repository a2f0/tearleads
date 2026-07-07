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
    hasSelectedDocumentLinkTargets: true,
    isActiveContactsContainer: true,
    modalState: {
      openCreateChildModal: () => undefined,
      openLinkDocumentModal: () => undefined,
      openMoveDocumentModal: () => undefined,
    },
    openInlineDocument: () => undefined,
    routeState: {
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

function ExplorerRoutedChromeHarness({
  model,
  openStructuredDocumentGrid = () => undefined,
  triggerUpload = () => undefined,
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

test("contacts container toolbar only offers new contact", async () => {
  const createdContacts: Array<[string, string]> = [];
  const view = render(
    <WindowMenuProvider>
      <ExplorerRoutedChromeHarness
        model={createExplorerModel({
          openInlineDocument: (containerId, documentKind) => {
            createdContacts.push([containerId, documentKind]);
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
});

test("document toolbar hides link when there are no link targets", async () => {
  const baseModel = createExplorerModel();
  const view = render(
    <WindowMenuProvider>
      <ExplorerRoutedChromeHarness
        model={createExplorerModel({
          canLinkSelectedDocument: false,
          hasSelectedDocumentLinkTargets: false,
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
