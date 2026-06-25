import { afterEach, expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { WindowStateProvider } from "../../../components/window/WindowStateProvider";
import { AppNavigationProvider } from "../../../navigation/AppNavigationProvider";
import type { MiniAppDefinition, MiniAppId } from "../../types";
import { useExplorerRoute } from "./useExplorerRoute";
import { useExplorerSelection } from "./useExplorerSelection";

const nodes: ContainerNode[] = [
  {
    id: "root-container",
    kind: "container",
    name: "Root",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "contacts-container",
    kind: "container",
    name: "Contacts",
    organizationId: "org-1",
    parentId: "root-container",
    syncState: syncedContainerDocumentObjectSyncState,
  },
];

function EmptyMiniApp() {
  return null;
}

const TEST_MINI_APPS = {
  "backup-restore": {
    createComponent: () => EmptyMiniApp,
    title: "Backup / Restore",
  },
  contacts: { createComponent: () => EmptyMiniApp, title: "Contacts" },
  explorer: { createComponent: () => EmptyMiniApp, title: "Explorer" },
  "identity-manager": {
    createComponent: () => EmptyMiniApp,
    title: "Identity Manager",
  },
  notes: { createComponent: () => EmptyMiniApp, title: "Notes" },
  "org-manager": { createComponent: () => EmptyMiniApp, title: "Org Manager" },
  "system-monitor": {
    createComponent: () => EmptyMiniApp,
    title: "System Monitor",
  },
} satisfies Readonly<Record<MiniAppId, MiniAppDefinition>>;

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function ExplorerRouteSelectionHarness() {
  const selection = useExplorerSelection(nodes, []);
  const routeState = useExplorerRoute({
    nodes,
    selectDocument: selection.selectDocument,
    setSelectedId: selection.setSelectedId,
  });

  return (
    <>
      <button
        type="button"
        onClick={() => routeState.selectExplorerItem("contacts-container")}
      >
        Contacts
      </button>
      <button
        type="button"
        onClick={() => {
          selection.selectDocument("you-contact", "contacts-container");
          routeState.selectExplorerDocument(
            "you-contact",
            "contacts-container",
          );
        }}
      >
        You
      </button>
      <div data-testid="selected-id">{selection.selectedId}</div>
      <div data-testid="active-container">{selection.activeContainerId}</div>
      <div data-testid="route-view">{routeState.route.view}</div>
    </>
  );
}

function renderExplorerRouteSelectionHarness() {
  window.history.replaceState(null, "", "/app/explorer");
  return render(
    <WindowStateProvider>
      <AppNavigationProvider mode="routed" miniApps={TEST_MINI_APPS}>
        <ExplorerRouteSelectionHarness />
      </AppNavigationProvider>
    </WindowStateProvider>,
  );
}

test("document route sync preserves pending sidebar document selection", async () => {
  const view = renderExplorerRouteSelectionHarness();

  await waitFor(() => {
    expect(view.getByTestId("selected-id").textContent).toBe("root-container");
  });

  fireEvent.click(view.getByRole("button", { name: "Contacts" }));

  await waitFor(() => {
    expect(view.getByTestId("selected-id").textContent).toBe(
      "contacts-container",
    );
    expect(view.getByTestId("active-container").textContent).toBe(
      "contacts-container",
    );
  });

  fireEvent.click(view.getByRole("button", { name: "You" }));

  await act(async () => undefined);

  await waitFor(() => {
    expect(view.getByTestId("route-view").textContent).toBe(
      "document-selection",
    );
    expect(view.getByTestId("selected-id").textContent).toBe("you-contact");
    expect(view.getByTestId("active-container").textContent).toBe(
      "contacts-container",
    );
  });
});
