import { type PropsWithChildren, useCallback } from "react";
import { MiniAppBoundary } from "../components/mini-app/MiniAppBoundary";
import { Window } from "../components/window/Window";
import {
  useWindowActions,
  type WindowEntry,
} from "../components/window/WindowStateProvider";
import { MiniAppRouteSegmentsProvider } from "../navigation/MiniAppRouteSegmentsContext";
import { isMiniAppId } from "./types";

const EMPTY_ROUTE_SEGMENTS: ReadonlyArray<string> = [];

// Gives a mini-app window its route (backed by the window's own Back stack) and
// the mini-app error boundary. Windows that no mini-app owns render bare.
function MiniAppWindowBoundary({
  children,
  entry,
}: PropsWithChildren<{ entry: WindowEntry }>) {
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

  if (!isMiniAppId(entry.appId)) {
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
      <MiniAppBoundary appId={entry.appId}>{children}</MiniAppBoundary>
    </MiniAppRouteSegmentsProvider>
  );
}

export function MiniAppWindow({ windowId }: { windowId: string }) {
  return <Window ContentBoundary={MiniAppWindowBoundary} windowId={windowId} />;
}
