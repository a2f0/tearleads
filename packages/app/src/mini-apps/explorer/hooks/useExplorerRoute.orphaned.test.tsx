import { afterEach, expect, test } from "bun:test";
import type { ContainerNode, DocumentSummary } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, useCallback } from "react";
import { WindowStateProvider } from "../../../components/window/WindowStateProvider";
import { AppNavigationProvider } from "../../../navigation/AppNavigationProvider";
import {
  createExplorerOrphanedDocumentsNode,
  EXPLORER_ORPHANED_DOCUMENTS_ID,
} from "../../../stores/explorer/orphanedDocuments";
import type { ExplorerRouteDocumentSummaryResult } from "../../../stores/explorer/useExplorerDocumentSummaryState";
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
  createExplorerOrphanedDocumentsNode("org-1", "Orphaned Documents"),
];
const cachedForeignOrphan: DocumentSummary = {
  containerId: null,
  documentId: "remote-foreign-orphan",
  id: "foreign-orphan",
  title: "Foreign orphan",
  updatedAt: "2026-07-30T00:00:00.000Z",
};
const routeLoadCalls: Array<[string, string]> = [];
const rejectOrphanRouteDocument = (
  localId: string,
  routeContainerId: string,
) => {
  routeLoadCalls.push([localId, routeContainerId]);
  return Promise.resolve({ status: "rejected" as const });
};
const deferUndiscoveredRouteDocument = (
  localId: string,
  routeContainerId: string,
) => {
  routeLoadCalls.push([localId, routeContainerId]);
  return Promise.resolve({ status: "pending" as const });
};
const resolveCachedForeignRouteDocument = (
  localId: string,
  routeContainerId: string,
) => {
  routeLoadCalls.push([localId, routeContainerId]);
  return Promise.resolve({
    documentSummary: cachedForeignOrphan,
    status: "loaded" as const,
  });
};

const rejectDestroyedWorkerRouteDocument = (
  localId: string,
  routeContainerId: string,
) => {
  routeLoadCalls.push([localId, routeContainerId]);
  return Promise.reject(
    new Error("Database worker client has been destroyed."),
  );
};

function EmptyMiniApp() {
  return null;
}

const TEST_MINI_APPS = {
  "backup-restore": { createComponent: () => EmptyMiniApp, title: "Backup" },
  contacts: { createComponent: () => EmptyMiniApp, title: "Contacts" },
  explorer: { createComponent: () => EmptyMiniApp, title: "Explorer" },
  "identity-manager": {
    createComponent: () => EmptyMiniApp,
    title: "Identity",
  },
  notes: { createComponent: () => EmptyMiniApp, title: "Notes" },
  "org-manager": { createComponent: () => EmptyMiniApp, title: "Org" },
  root: { createComponent: () => () => null, title: "Root" },
  "system-monitor": { createComponent: () => EmptyMiniApp, title: "System" },
} satisfies Readonly<Record<MiniAppId, MiniAppDefinition>>;

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <WindowStateProvider>
      <AppNavigationProvider mode="routed" miniApps={TEST_MINI_APPS}>
        {children}
      </AppNavigationProvider>
    </WindowStateProvider>
  );
}

afterEach(() => {
  cleanup();
  routeLoadCalls.length = 0;
  window.history.replaceState(null, "", "/");
});

test("a rejected orphan deep link cannot select a cached foreign document", async () => {
  const path = `/app/explorer/containers/${EXPLORER_ORPHANED_DOCUMENTS_ID}/documents/foreign-orphan`;
  const happyDomWindow = window as typeof window & {
    happyDOM: { setURL: (url: string) => void };
  };
  happyDomWindow.happyDOM.setURL(`http://localhost${path}`);
  window.history.replaceState(null, "", path);
  const view = renderHook(
    () => {
      const selection = useExplorerSelection(nodes, [cachedForeignOrphan]);
      useExplorerRoute({
        loadDocumentSummary: rejectOrphanRouteDocument,
        logError: () => undefined,
        nodes,
        selectDocument: selection.selectDocument,
        setSelectedId: selection.setSelectedId,
      });
      return selection.selectedId;
    },
    { wrapper: TestProviders },
  );

  await waitFor(() => {
    expect(routeLoadCalls).toEqual([
      ["foreign-orphan", EXPLORER_ORPHANED_DOCUMENTS_ID],
    ]);
    expect(view.result.current).toBe("root-container");
  });
});

test("an ordinary-container deep link cannot select a cached orphan", async () => {
  const path =
    "/app/explorer/containers/root-container/documents/foreign-orphan";
  const happyDomWindow = window as typeof window & {
    happyDOM: { setURL: (url: string) => void };
  };
  happyDomWindow.happyDOM.setURL(`http://localhost${path}`);
  window.history.replaceState(null, "", path);
  const view = renderHook(
    () => {
      const selection = useExplorerSelection(nodes, [cachedForeignOrphan]);
      useExplorerRoute({
        loadDocumentSummary: resolveCachedForeignRouteDocument,
        logError: () => undefined,
        nodes,
        selectDocument: selection.selectDocument,
        setSelectedId: selection.setSelectedId,
      });
      return selection.selectedId;
    },
    { wrapper: TestProviders },
  );

  await waitFor(() => {
    expect(routeLoadCalls).toEqual([["foreign-orphan", "root-container"]]);
    expect(view.result.current).toBe("root-container");
  });
});

test("an undiscovered deep link remains an optimistic pending selection", async () => {
  const path =
    "/app/explorer/containers/root-container/documents/future-document";
  const happyDomWindow = window as typeof window & {
    happyDOM: { setURL: (url: string) => void };
  };
  happyDomWindow.happyDOM.setURL(`http://localhost${path}`);
  window.history.replaceState(null, "", path);
  const view = renderHook(
    () => {
      const selection = useExplorerSelection(nodes, []);
      useExplorerRoute({
        loadDocumentSummary: deferUndiscoveredRouteDocument,
        logError: () => undefined,
        nodes,
        selectDocument: selection.selectDocument,
        setSelectedId: selection.setSelectedId,
      });
      return selection.selectedId;
    },
    { wrapper: TestProviders },
  );

  await waitFor(() => {
    expect(routeLoadCalls).toEqual([["future-document", "root-container"]]);
    expect(view.result.current).toBe("future-document");
  });
});

test("a deferred deep link remains pending until the database is ready", async () => {
  const path =
    "/app/explorer/containers/root-container/documents/ready-document";
  const happyDomWindow = window as typeof window & {
    happyDOM: { setURL: (url: string) => void };
  };
  happyDomWindow.happyDOM.setURL(`http://localhost${path}`);
  window.history.replaceState(null, "", path);
  const readyDocument: DocumentSummary = {
    containerId: "root-container",
    documentId: "remote-ready-document",
    id: "ready-document",
    title: "Ready document",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
  const view = renderHook(
    ({ ready }: { ready: boolean }) => {
      const selection = useExplorerSelection(nodes, [readyDocument]);
      const loadDocumentSummary = useCallback(
        (): Promise<ExplorerRouteDocumentSummaryResult> =>
          Promise.resolve(
            ready
              ? { documentSummary: readyDocument, status: "loaded" }
              : { status: "deferred" },
          ),
        [ready],
      );
      useExplorerRoute({
        loadDocumentSummary,
        logError: () => undefined,
        nodes,
        selectDocument: selection.selectDocument,
        setSelectedId: selection.setSelectedId,
      });
      return selection.selectedId;
    },
    { initialProps: { ready: false }, wrapper: TestProviders },
  );

  await waitFor(() => expect(view.result.current).toBe("root-container"));
  view.rerender({ ready: true });
  await waitFor(() => expect(view.result.current).toBe("ready-document"));
});

test("a worker teardown rejection is handled during route restoration", async () => {
  const teardownReports: unknown[] = [];
  const path =
    "/app/explorer/containers/root-container/documents/foreign-orphan";
  const happyDomWindow = window as typeof window & {
    happyDOM: { setURL: (url: string) => void };
  };
  happyDomWindow.happyDOM.setURL(`http://localhost${path}`);
  window.history.replaceState(null, "", path);
  const view = renderHook(
    () => {
      const selection = useExplorerSelection(nodes, [cachedForeignOrphan]);
      useExplorerRoute({
        loadDocumentSummary: rejectDestroyedWorkerRouteDocument,
        logError: (_message, cause) => {
          teardownReports.push(cause);
        },
        nodes,
        selectDocument: selection.selectDocument,
        setSelectedId: selection.setSelectedId,
      });
      return selection.selectedId;
    },
    { wrapper: TestProviders },
  );

  await waitFor(() => {
    expect(routeLoadCalls).toEqual([["foreign-orphan", "root-container"]]);
    expect(view.result.current).toBe("root-container");
  });
  expect(teardownReports).toEqual([]);
});

test("a failed route restoration reports the original error", async () => {
  const failure = new Error("route summary lookup failed");
  const logged: Array<[string | Error, unknown]> = [];
  const path =
    "/app/explorer/containers/root-container/documents/foreign-orphan";
  const happyDomWindow = window as typeof window & {
    happyDOM: { setURL: (url: string) => void };
  };
  happyDomWindow.happyDOM.setURL(`http://localhost${path}`);
  window.history.replaceState(null, "", path);
  const view = renderHook(
    () => {
      const selection = useExplorerSelection(nodes, [cachedForeignOrphan]);
      useExplorerRoute({
        loadDocumentSummary: () => Promise.reject(failure),
        logError: (message, cause) => {
          logged.push([message, cause]);
        },
        nodes,
        selectDocument: selection.selectDocument,
        setSelectedId: selection.setSelectedId,
      });
      return selection.selectedId;
    },
    { wrapper: TestProviders },
  );

  // The selection effect can run more than once per mount; every run reports
  // the same failure and nothing else.
  await waitFor(() => {
    expect(logged).toContainEqual([
      "Failed to restore the explorer document route",
      failure,
    ]);
  });
  expect(new Set(logged.map(([message]) => message))).toEqual(
    new Set(["Failed to restore the explorer document route"]),
  );
  expect(view.result.current).toBeNull();
});
