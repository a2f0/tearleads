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
import {
  AppNavigationProvider,
  useMiniAppRouteSegments,
} from "../../../navigation/AppNavigationProvider";
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

// Stable reference so the route-restoration effect's dependency is constant
// across renders. These hook-level tests assert selection/route wiring via the
// pending-selection mechanism, not summary loading, so a no-op suffices.
const noopLoadDocumentSummary = () => Promise.resolve(null);

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
  const appRoute = useMiniAppRouteSegments("explorer");
  const selection = useExplorerSelection(nodes, []);
  const routeState = useExplorerRoute({
    loadDocumentSummary: noopLoadDocumentSummary,
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
        onClick={() =>
          routeState.selectExplorerDocument("you-contact", "contacts-container")
        }
      >
        You
      </button>
      <button
        type="button"
        onClick={() =>
          routeState.openDocumentInfoRoute("you-contact", "contacts-container")
        }
      >
        You Info
      </button>
      <button
        type="button"
        onClick={() =>
          routeState.openBlobBrowserRoute({
            storageKey: "front-storage-key",
          })
        }
      >
        Open Front Blob
      </button>
      <button type="button" onClick={routeState.navigateBackFromBlobBrowser}>
        Blob Back
      </button>
      <button type="button" onClick={routeState.openWriteQueueRoute}>
        Open Writes
      </button>
      <button
        type="button"
        onClick={() =>
          appRoute.setPathSegments(
            ["blobs", "storage", "external-storage-key"],
            { replace: true },
          )
        }
      >
        External Blob Route
      </button>
      <button
        type="button"
        onClick={() =>
          routeState.selectExplorerDocument("you-contact", "contacts-container")
        }
      >
        Back To You
      </button>
      <div data-testid="selected-id">{selection.selectedId}</div>
      <div data-testid="active-container">{selection.activeContainerId}</div>
      <div data-testid="route-view">{routeState.route.view}</div>
      <div data-testid="route-storage-key">
        {routeState.route.view === "blob-browser"
          ? routeState.route.storageKey
          : ""}
      </div>
    </>
  );
}

function renderExplorerRouteSelectionHarness(
  mode: "routed" | "windowed",
  path = "/app/explorer",
) {
  const happyDomWindow = window as typeof window & {
    happyDOM: { setURL: (url: string) => void };
  };
  happyDomWindow.happyDOM.setURL(`http://localhost${path}`);
  window.history.replaceState(null, "", path);
  return render(
    <WindowStateProvider>
      <AppNavigationProvider mode={mode} miniApps={TEST_MINI_APPS}>
        <ExplorerRouteSelectionHarness />
      </AppNavigationProvider>
    </WindowStateProvider>,
  );
}

test("write queue opener updates the routed path", async () => {
  const view = renderExplorerRouteSelectionHarness("routed");

  fireEvent.click(view.getByRole("button", { name: "Open Writes" }));

  await waitFor(() => {
    expect(view.getByTestId("route-view").textContent).toBe("write-queue");
    expect(window.location.pathname).toBe("/app/explorer/writes");
  });
});

test("document route sync preserves pending sidebar document selection", async () => {
  const view = renderExplorerRouteSelectionHarness("routed");

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

async function expectDocumentInfoBackRestoresDocumentSelection(
  mode: "routed" | "windowed",
) {
  const view = renderExplorerRouteSelectionHarness(mode);

  await waitFor(() => {
    expect(view.getByTestId("selected-id").textContent).toBe("root-container");
  });

  fireEvent.click(view.getByRole("button", { name: "Contacts" }));

  await waitFor(() => {
    expect(view.getByTestId("selected-id").textContent).toBe(
      "contacts-container",
    );
  });

  fireEvent.click(view.getByRole("button", { name: "You Info" }));

  await waitFor(() => {
    expect(view.getByTestId("route-view").textContent).toBe("document-info");
    expect(view.getByTestId("selected-id").textContent).toBe(
      "contacts-container",
    );
  });

  fireEvent.click(view.getByRole("button", { name: "Back To You" }));

  await waitFor(() => {
    expect(view.getByTestId("route-view").textContent).toBe(
      "document-selection",
    );
    expect(view.getByTestId("selected-id").textContent).toBe("you-contact");
    expect(view.getByTestId("active-container").textContent).toBe(
      "contacts-container",
    );
  });
}

test("document info back restores the document route in routed mode", async () => {
  await expectDocumentInfoBackRestoresDocumentSelection("routed");
});

test("document info back restores the document route in windowed mode", async () => {
  await expectDocumentInfoBackRestoresDocumentSelection("windowed");
});

test("windowed blob back restores the document that opened the attachment", async () => {
  const view = renderExplorerRouteSelectionHarness("windowed");

  fireEvent.click(view.getByRole("button", { name: "You" }));
  await waitFor(() => {
    expect(view.getByTestId("route-view").textContent).toBe(
      "document-selection",
    );
    expect(view.getByTestId("selected-id").textContent).toBe("you-contact");
  });

  fireEvent.click(view.getByRole("button", { name: "Open Front Blob" }));
  await waitFor(() => {
    expect(view.getByTestId("route-view").textContent).toBe("blob-browser");
    expect(view.getByTestId("route-storage-key").textContent).toBe(
      "front-storage-key",
    );
  });

  fireEvent.click(view.getByRole("button", { name: "Blob Back" }));
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

test("routed direct blob link falls back without creating a history loop", async () => {
  const view = renderExplorerRouteSelectionHarness(
    "routed",
    "/app/explorer/blobs/storage/front-storage-key",
  );

  await waitFor(() => {
    expect(view.getByTestId("route-view").textContent).toBe("blob-browser");
    expect(view.getByTestId("route-storage-key").textContent).toBe(
      "front-storage-key",
    );
  });

  fireEvent.click(view.getByRole("button", { name: "Blob Back" }));
  await waitFor(() => {
    expect(window.location.pathname).toBe("/app/explorer/blobs");
    expect(view.getByTestId("route-storage-key").textContent).toBe("");
  });

  fireEvent.click(view.getByRole("button", { name: "Blob Back" }));
  await waitFor(() => {
    expect(window.location.pathname).toBe("/app/explorer");
    expect(view.getByTestId("route-view").textContent).toBe("selection");
  });
});

test("an abandoned blob visit cannot leak its origin into a later deep link", async () => {
  const view = renderExplorerRouteSelectionHarness("routed");

  fireEvent.click(view.getByRole("button", { name: "You" }));
  await waitFor(() => {
    expect(view.getByTestId("route-view").textContent).toBe(
      "document-selection",
    );
  });
  fireEvent.click(view.getByRole("button", { name: "Open Front Blob" }));
  await waitFor(() => {
    expect(view.getByTestId("route-view").textContent).toBe("blob-browser");
  });

  fireEvent.click(view.getByRole("button", { name: "Contacts" }));
  await waitFor(() => {
    expect(view.getByTestId("route-view").textContent).toBe("selection");
    expect(view.getByTestId("selected-id").textContent).toBe(
      "contacts-container",
    );
  });

  fireEvent.click(view.getByRole("button", { name: "External Blob Route" }));
  await waitFor(() => {
    expect(view.getByTestId("route-storage-key").textContent).toBe(
      "external-storage-key",
    );
  });

  fireEvent.click(view.getByRole("button", { name: "Blob Back" }));
  await waitFor(() => {
    expect(view.getByTestId("route-view").textContent).toBe("blob-browser");
    expect(view.getByTestId("route-storage-key").textContent).toBe("");
  });
});
