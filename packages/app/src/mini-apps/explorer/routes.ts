import type { ContainerNode } from "@tearleads/client-sdk";
import { isExplorerOrphanedDocumentsId } from "../../stores/explorer/orphanedDocuments";

/** A section of the Outgoing tab a link can scroll to the top. */
export type ExplorerOutgoingSection = "uploads" | "writes";

export type ExplorerRoute =
  | { view: "selection" }
  | { view: "blob-browser"; blobId: string | null; storageKey: string | null }
  | { view: "sync-lanes" }
  | { view: "sync-lane-detail"; laneKey: string }
  | { view: "outgoing"; section: ExplorerOutgoingSection | null }
  | { view: "write-queue-entry"; entryKey: string }
  | { view: "incoming" }
  | { view: "new-structured-document"; containerId: string }
  | { view: "container-info"; containerId: string }
  | { view: "document-selection"; containerId: string; localId: string }
  | { view: "document-info"; containerId: string; localId: string }
  | { view: "document-history"; containerId: string; localId: string };

export const DEFAULT_EXPLORER_ROUTE: ExplorerRoute = { view: "selection" };

export interface ExplorerRouteSnapshot {
  route: ExplorerRoute;
  selectedId?: string | null | undefined;
}

/**
 * Navigation options for the route actions a detail "Back" fallback uses. That
 * fallback only exists where the host has NO history entry to pop, so it must
 * replace the dead-end entry rather than push its parent on top: pushing would
 * create the single history entry that makes Back alternate between the two
 * routes forever (see chromeOwnsRouteBackedDetailBack).
 */
export interface ExplorerRouteNavigationOptions {
  replace?: boolean | undefined;
}

export interface ExplorerOutgoingRouteOptions
  extends ExplorerRouteNavigationOptions {
  /** The section to scroll to the top; omitted opens the tab at its top. */
  section?: ExplorerOutgoingSection | undefined;
}

export type ExplorerRouteSetter = (
  nextRoute: ExplorerRoute,
  selectedId?: string | null | undefined,
  options?: ExplorerRouteNavigationOptions,
) => void;

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
    if (fifth === "history") {
      return {
        route: { containerId, localId: fourth, view: "document-history" },
      };
    }

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

function parseExplorerSyncRoute(
  pathSegments: ReadonlyArray<string>,
): ExplorerRouteSnapshot {
  const [, second, third] = pathSegments;
  if (second === "lanes" && third) {
    return { route: { laneKey: third, view: "sync-lane-detail" } };
  }

  return { route: { view: "sync-lanes" } };
}

function parseExplorerOutgoingRoute(
  pathSegments: ReadonlyArray<string>,
): ExplorerRouteSnapshot {
  const [, section, entryKey] = pathSegments;
  if (section === "writes") {
    return entryKey
      ? { route: { entryKey, view: "write-queue-entry" } }
      : { route: { section, view: "outgoing" } };
  }
  return {
    route: {
      section: section === "uploads" ? section : null,
      view: "outgoing",
    },
  };
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
    return parseExplorerSyncRoute(pathSegments);
  }

  if (first === "outgoing") {
    return parseExplorerOutgoingRoute(pathSegments);
  }

  if (first === "incoming") return { route: { view: "incoming" } };

  if (first === "containers") {
    return parseExplorerContainerRoute(pathSegments);
  }

  return { route: DEFAULT_EXPLORER_ROUTE, selectedId: null };
}

export function formatExplorerRouteSegments(
  route: ExplorerRoute,
  selectedId?: string | null | undefined,
): ReadonlyArray<string> {
  switch (route.view) {
    case "selection":
      return selectedId ? ["items", selectedId] : [];
    case "blob-browser":
      return formatBlobBrowserSegments(route);
    case "sync-lanes":
      return ["sync"];
    case "sync-lane-detail":
      return ["sync", "lanes", route.laneKey];
    case "outgoing":
      return route.section ? ["outgoing", route.section] : ["outgoing"];
    case "write-queue-entry":
      return ["outgoing", "writes", route.entryKey];
    case "incoming":
      return ["incoming"];
    case "container-info":
      return ["containers", route.containerId, "info"];
    case "new-structured-document":
      return ["containers", route.containerId, "new"];
    case "document-selection":
      return ["containers", route.containerId, "documents", route.localId];
    case "document-history":
      return [
        "containers",
        route.containerId,
        "documents",
        route.localId,
        "history",
      ];
    default:
      return [
        "containers",
        route.containerId,
        "documents",
        route.localId,
        "info",
      ];
  }
}

function formatBlobBrowserSegments(
  route: Extract<ExplorerRoute, { view: "blob-browser" }>,
): ReadonlyArray<string> {
  if (route.storageKey) {
    return route.blobId
      ? ["blobs", "storage", route.storageKey, "blob", route.blobId]
      : ["blobs", "storage", route.storageKey];
  }

  return route.blobId ? ["blobs", "blob", route.blobId] : ["blobs"];
}

export function isExplorerRouteAvailable(
  route: ExplorerRoute,
  nodes: ReadonlyArray<ContainerNode>,
): boolean {
  // Only container-backed routes can dangle; every other view is always
  // available.
  if (!("containerId" in route)) {
    return true;
  }

  if (isExplorerOrphanedDocumentsId(route.containerId)) {
    return (
      route.view === "document-selection" ||
      route.view === "document-info" ||
      route.view === "document-history"
    );
  }

  return nodes.some((node) => node.id === route.containerId);
}
