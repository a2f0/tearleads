import type { ContainerNode } from "@tearleads/client-sdk";

export type ExplorerRoute =
  | { view: "selection" }
  | { view: "blob-browser"; blobId: string | null; storageKey: string | null }
  | { view: "sync-lanes" }
  | { view: "new-structured-document"; containerId: string }
  | { view: "container-info"; containerId: string }
  | { view: "document-selection"; containerId: string; localId: string }
  | { view: "document-info"; containerId: string; localId: string };

export const DEFAULT_EXPLORER_ROUTE: ExplorerRoute = { view: "selection" };

export interface ExplorerRouteSnapshot {
  route: ExplorerRoute;
  selectedId?: string | null | undefined;
}

function parseExplorerBlobRoute(
  pathSegments: ReadonlyArray<string>,
): ExplorerRouteSnapshot {
  const [, second, third, fourth, fifth] = pathSegments;
  if (second === "storage" && third) {
    return {
      route: {
        blobId: fourth === "blob" ? (fifth ?? null) : null,
        storageKey: third,
        view: "blob-browser",
      },
    };
  }

  if (second === "blob" && third) {
    return {
      route: { blobId: third, storageKey: null, view: "blob-browser" },
    };
  }

  return {
    route: { blobId: null, storageKey: null, view: "blob-browser" },
  };
}

function parseExplorerContainerRoute(
  pathSegments: ReadonlyArray<string>,
): ExplorerRouteSnapshot {
  const [, containerId, third, fourth, fifth] = pathSegments;
  if (!containerId) {
    return { route: DEFAULT_EXPLORER_ROUTE, selectedId: null };
  }

  if (third === "info") {
    return {
      route: { containerId, view: "container-info" },
      selectedId: containerId,
    };
  }

  if (third === "new") {
    return {
      route: { containerId, view: "new-structured-document" },
      selectedId: containerId,
    };
  }

  if (third === "documents" && fourth) {
    return fifth === "info"
      ? {
          route: {
            containerId,
            localId: fourth,
            view: "document-info",
          },
        }
      : {
          route: {
            containerId,
            localId: fourth,
            view: "document-selection",
          },
          selectedId: fourth,
        };
  }

  return { route: DEFAULT_EXPLORER_ROUTE, selectedId: containerId };
}

export function parseExplorerRouteSegments(
  pathSegments: ReadonlyArray<string>,
): ExplorerRouteSnapshot {
  const [first, second] = pathSegments;

  if (!first) {
    return { route: DEFAULT_EXPLORER_ROUTE, selectedId: null };
  }

  if (first === "items" && second) {
    return { route: DEFAULT_EXPLORER_ROUTE, selectedId: second };
  }

  if (first === "blobs") {
    return parseExplorerBlobRoute(pathSegments);
  }

  if (first === "sync") {
    return { route: { view: "sync-lanes" } };
  }

  if (first === "containers") {
    return parseExplorerContainerRoute(pathSegments);
  }

  return { route: DEFAULT_EXPLORER_ROUTE, selectedId: null };
}

export function formatExplorerRouteSegments(
  route: ExplorerRoute,
  selectedId?: string | null | undefined,
): ReadonlyArray<string> {
  if (route.view === "selection") {
    return selectedId ? ["items", selectedId] : [];
  }

  if (route.view === "blob-browser") {
    if (route.storageKey) {
      return route.blobId
        ? ["blobs", "storage", route.storageKey, "blob", route.blobId]
        : ["blobs", "storage", route.storageKey];
    }

    return route.blobId ? ["blobs", "blob", route.blobId] : ["blobs"];
  }

  if (route.view === "sync-lanes") {
    return ["sync"];
  }

  if (route.view === "container-info") {
    return ["containers", route.containerId, "info"];
  }

  if (route.view === "new-structured-document") {
    return ["containers", route.containerId, "new"];
  }

  if (route.view === "document-selection") {
    return ["containers", route.containerId, "documents", route.localId];
  }

  return ["containers", route.containerId, "documents", route.localId, "info"];
}

export function isExplorerRouteAvailable(
  route: ExplorerRoute,
  nodes: ReadonlyArray<ContainerNode>,
): boolean {
  if (route.view === "selection") {
    return true;
  }

  if (route.view === "blob-browser") {
    return true;
  }

  if (route.view === "sync-lanes") {
    return true;
  }

  return nodes.some((node) => node.id === route.containerId);
}
