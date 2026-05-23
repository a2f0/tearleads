import type { ContainerNode } from "../../stores/explorer/types";

export type ExplorerRoute =
  | { view: "selection" }
  | { view: "container-info"; containerId: string }
  | { view: "document-info"; containerId: string; localId: string };

export const DEFAULT_EXPLORER_ROUTE: ExplorerRoute = { view: "selection" };

export function isExplorerRouteAvailable(
  route: ExplorerRoute,
  nodes: ReadonlyArray<ContainerNode>,
): boolean {
  if (route.view === "selection") {
    return true;
  }

  return nodes.some((node) => node.id === route.containerId);
}
