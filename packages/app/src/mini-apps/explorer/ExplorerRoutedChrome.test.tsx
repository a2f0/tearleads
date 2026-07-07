import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
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
    explorer: { ready: true },
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
    isRoutedShell: true,
    model,
    openStructuredDocumentGrid,
    triggerUpload,
  });

  return <ToolbarProbe />;
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
