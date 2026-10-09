import {
  type ComponentType,
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
} from "react";
import { Window } from "../window/Window";
import {
  useWindowActions,
  type WindowEntry,
} from "../window/WindowStateProvider";
import { useLauncherNavigationState } from "./LauncherNavigationProvider";
import { isLauncherAppId } from "./launcherDefinition";
import { MiniAppRouteSegmentsProvider } from "./MiniAppRouteSegmentsContext";

/**
 * Wraps a mini-app wherever the launcher renders one, in a window or the
 * routed shell, such as an error boundary that fails inside the app. It
 * receives the app's id as the definition names it.
 */
export type MiniAppBoundary = ComponentType<
  PropsWithChildren<{ appId: string }>
>;

const EMPTY_ROUTE_SEGMENTS: ReadonlyArray<string> = [];

function PassThroughBoundary({ children }: PropsWithChildren) {
  return children;
}

const AppBoundaryContext = createContext<MiniAppBoundary>(PassThroughBoundary);

// Gives a mini-app window its route (backed by the window's own Back stack) and
// the host's app boundary. Windows that no mini-app owns render bare.
function MiniAppWindowBoundary({
  children,
  entry,
}: PropsWithChildren<{ entry: WindowEntry }>) {
  const AppBoundary = useContext(AppBoundaryContext);
  const { definition } = useLauncherNavigationState();
  const { goBackRoute, updateRoute } = useWindowActions();
  const setPathSegments = useCallback(
    (
      pathSegments: ReadonlyArray<string>,
      options: { replace?: boolean | undefined } = {},
    ) => {
      // Forward `replace` rather than dropping it: it is what keeps a transient
      // step (a picker, a corrected unavailable route) out of this window's
      // Back stack.
      updateRoute(entry.id, pathSegments, options);
    },
    [entry.id, updateRoute],
  );
  const goBack = useCallback(() => {
    goBackRoute(entry.id);
  }, [entry.id, goBackRoute]);

  if (!isLauncherAppId(definition, entry.appId)) {
    return children;
  }

  return (
    <MiniAppRouteSegmentsProvider
      appId={entry.appId}
      canGoBack={(entry.routeHistory?.length ?? 0) > 0}
      goBack={goBack}
      pathSegments={entry.pathSegments ?? EMPTY_ROUTE_SEGMENTS}
      setPathSegments={setPathSegments}
      windowId={entry.id}
    >
      <AppBoundary appId={entry.appId}>{children}</AppBoundary>
    </MiniAppRouteSegmentsProvider>
  );
}

/**
 * A window for one of the launcher's mini-apps, inside a
 * {@link LauncherNavigationProvider}. The app reads its route with
 * {@link useMiniAppRouteSegments}, backed by the window's own Back stack.
 */
export function MiniAppWindow({
  AppBoundary = PassThroughBoundary,
  windowId,
}: {
  AppBoundary?: MiniAppBoundary | undefined;
  windowId: string;
}) {
  return (
    <AppBoundaryContext.Provider value={AppBoundary}>
      <Window ContentBoundary={MiniAppWindowBoundary} windowId={windowId} />
    </AppBoundaryContext.Provider>
  );
}
