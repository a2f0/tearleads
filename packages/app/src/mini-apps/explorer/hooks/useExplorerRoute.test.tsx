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
// across renders. Ordinary document routes now validate the resolved summary
// before selecting it, so this harness returns the matching stored container.
const loadTestDocumentSummary = (localId: string, routeContainerId: string) =>
  Promise.resolve({
    documentSummary: {
      containerId: routeContainerId,
      documentId: localId,
      id: localId,
      title: "You",
      updatedAt: "2026-07-30T00:00:00.000Z",
    },
    status: "loaded" as const,
  });

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
    loadDocumentSummary: loadTestDocumentSummary,
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
      <button
        type="button"
        onClick={() =>
          routeState.openNewStructuredDocumentRoute("contacts-container")
        }
      >
        New Document
      </button>
      <button
        type="button"
        onClick={() => routeState.selectCreatedExplorerItem("new-document")}
      >
        Create Document
      </button>
      <button type="button" onClick={() => routeState.openWriteQueueRoute()}>
        Open Writes
      </button>
      <button type="button" onClick={routeState.openUploadsRoute}>
        Open Uploads
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

test("uploads opener updates the routed path", async () => {
  const view = renderExplorerRouteSelectionHarness("routed");

  fireEvent.click(view.getByRole("button", { name: "Open Uploads" }));

  await waitFor(() => {
    expect(view.getByTestId("route-view").textContent).toBe("uploads");
    expect(window.location.pathname).toBe("/app/explorer/uploads");
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

function spyHistory() {
  const pushedUrls: Array<string | URL | null | undefined> = [];
  const replacedUrls: Array<string | URL | null | undefined> = [];
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;
  window.history.pushState = function pushStateSpy(
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    pushedUrls.push(url);
    return originalPushState.call(window.history, data, unused, url);
  };
  window.history.replaceState = function replaceStateSpy(
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    if (url !== undefined) {
      replacedUrls.push(url);
    }
    return originalReplaceState.call(window.history, data, unused, url);
  };

  return {
    pushedUrls,
    replacedUrls,
    restore: () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    },
  };
}

test("creating a document replaces the blank document-type picker", async () => {
  const view = renderExplorerRouteSelectionHarness("routed");
  const history = spyHistory();

  try {
    fireEvent.click(view.getByRole("button", { name: "New Document" }));
    await waitFor(() => {
      expect(view.getByTestId("route-view").textContent).toBe(
        "new-structured-document",
      );
      expect(window.location.pathname).toBe(
        "/app/explorer/containers/contacts-container/new",
      );
    });

    fireEvent.click(view.getByRole("button", { name: "Create Document" }));

    await waitFor(() => {
      expect(view.getByTestId("route-view").textContent).toBe("selection");
      expect(view.getByTestId("selected-id").textContent).toBe("new-document");
    });
    // Only opening the picker pushed; the document took the picker's place.
    expect(history.pushedUrls).toEqual([
      "/app/explorer/containers/contacts-container/new",
    ]);
    expect(history.replacedUrls.at(-1)).toBe(
      "/app/explorer/items/new-document",
    );
  } finally {
    history.restore();
  }
});

test("creating a document outside the picker pushes", async () => {
  const view = renderExplorerRouteSelectionHarness("routed");
  const history = spyHistory();

  try {
    // The Explorer's "New Contact" shortcut skips the picker, so there is no
    // transient entry to prune and the new document pushes as usual.
    fireEvent.click(view.getByRole("button", { name: "Create Document" }));

    await waitFor(() => {
      expect(view.getByTestId("selected-id").textContent).toBe("new-document");
    });
    expect(history.pushedUrls).toEqual(["/app/explorer/items/new-document"]);
  } finally {
    history.restore();
  }
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
