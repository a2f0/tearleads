import { type PropsWithChildren, useCallback } from "react";
import { MiniAppRouteSegmentsProvider } from "../../navigation/MiniAppRouteSegmentsContext";
import { useWindowActions, type WindowEntry } from "./WindowStateProvider";

interface WindowMiniAppRouteBoundaryProps extends PropsWithChildren {
  entry: WindowEntry;
}

const EMPTY_ROUTE_SEGMENTS: ReadonlyArray<string> = [];

export function WindowMiniAppRouteBoundary({
  children,
  entry,
}: WindowMiniAppRouteBoundaryProps) {
  const { updateMiniAppRoute } = useWindowActions();
  const setPathSegments = useCallback(
    (pathSegments: ReadonlyArray<string>) => {
      updateMiniAppRoute(entry.id, pathSegments);
    },
    [entry.id, updateMiniAppRoute],
  );

  if (!entry.appId) {
    return children;
  }

  return (
    <MiniAppRouteSegmentsProvider
      appId={entry.appId}
      pathSegments={entry.miniAppPathSegments ?? EMPTY_ROUTE_SEGMENTS}
      setPathSegments={setPathSegments}
    >
      {children}
    </MiniAppRouteSegmentsProvider>
  );
}
