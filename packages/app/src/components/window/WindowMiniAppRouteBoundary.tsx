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
  const { goBackMiniAppRoute, updateMiniAppRoute } = useWindowActions();
  const setPathSegments = useCallback(
    (
      pathSegments: ReadonlyArray<string>,
      options: { replace?: boolean | undefined } = {},
    ) => {
      // Forward `replace` rather than dropping it: it is what keeps a transient
      // step (the new-document type picker, a corrected unavailable route) out
      // of this window's Back stack.
      updateMiniAppRoute(entry.id, pathSegments, options);
    },
    [entry.id, updateMiniAppRoute],
  );
  const goBack = useCallback(() => {
    goBackMiniAppRoute(entry.id);
  }, [entry.id, goBackMiniAppRoute]);

  if (!entry.appId) {
    return children;
  }

  return (
    <MiniAppRouteSegmentsProvider
      appId={entry.appId}
      canGoBack={(entry.miniAppRouteHistory?.length ?? 0) > 0}
      goBack={goBack}
      pathSegments={entry.miniAppPathSegments ?? EMPTY_ROUTE_SEGMENTS}
      setPathSegments={setPathSegments}
    >
      {children}
    </MiniAppRouteSegmentsProvider>
  );
}
