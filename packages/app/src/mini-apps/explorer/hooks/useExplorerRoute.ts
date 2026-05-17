import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_EXPLORER_ROUTE,
  type ExplorerRoute,
  isExplorerRouteAvailable,
} from "../routes";
import type { ContainerNode } from "../types";

export interface ExplorerRouteState {
  route: ExplorerRoute;
  openContainerInfoRoute: (containerId: string) => void;
  selectExplorerItem: (id: string | null) => void;
  showSelectionRoute: () => void;
}

export function useExplorerRoute(params: {
  nodes: ReadonlyArray<ContainerNode>;
  setSelectedId: (id: string | null) => void;
}): ExplorerRouteState {
  const { nodes, setSelectedId } = params;
  const [route, setRoute] = useState<ExplorerRoute>(DEFAULT_EXPLORER_ROUTE);

  useEffect(() => {
    if (!isExplorerRouteAvailable(route, nodes)) {
      setRoute(DEFAULT_EXPLORER_ROUTE);
    }
  }, [nodes, route]);

  const showSelectionRoute = useCallback(() => {
    setRoute(DEFAULT_EXPLORER_ROUTE);
  }, []);

  const selectExplorerItem = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setRoute(DEFAULT_EXPLORER_ROUTE);
    },
    [setSelectedId],
  );

  const openContainerInfoRoute = useCallback(
    (containerId: string) => {
      setSelectedId(containerId);
      setRoute({ view: "container-info", containerId });
    },
    [setSelectedId],
  );

  return {
    openContainerInfoRoute,
    route,
    selectExplorerItem,
    showSelectionRoute,
  };
}
