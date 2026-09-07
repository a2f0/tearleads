import { useCallback } from "react";
import {
  MiniAppButton,
  MiniAppRoot,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../components/mini-app/MiniAppLayout";
import { useAuthenticateAction } from "../../identity/useAuthenticateAction";
import { useCompactRoutedMode } from "../../navigation/useCompactRoutedMode";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import "./Root.css";
import { IdentitiesView } from "./identities/IdentitiesView";
import { IdentityDetailView } from "./identities/IdentityDetailView";
import { RootMenu } from "./RootMenu";
import { useRootSidebarPanel } from "./RootSidebar";
import {
  IDENTITIES_ROOT_ROUTE,
  type RootRoute,
  type RootView,
  rootRouteForView,
} from "./routes";
import { useRootRoute } from "./useRootRoute";

function RootAccessGate({ isAuthenticated }: { isAuthenticated: boolean }) {
  const { authenticate, authenticating, error } = useAuthenticateAction();

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Root</h2>
      </MiniAppSectionHeading>
      {isAuthenticated ? (
        <MiniAppStatus>
          This identity is not a platform operator. Root access is granted on
          the server with the API CLI.
        </MiniAppStatus>
      ) : (
        <>
          <MiniAppStatus>Log in to use the root console.</MiniAppStatus>
          {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
          <MiniAppToolbar>
            <MiniAppButton
              disabled={authenticating}
              onClick={() => void authenticate()}
            >
              {authenticating ? "Logging in..." : "Login"}
            </MiniAppButton>
          </MiniAppToolbar>
        </>
      )}
    </MiniAppSection>
  );
}

function RootContent({
  route,
  setRoute,
}: {
  route: RootRoute;
  setRoute: (route: RootRoute) => void;
}) {
  const setView = useCallback(
    (view: RootView) => setRoute(rootRouteForView(view)),
    [setRoute],
  );
  const selectIdentity = useCallback(
    (userId: string | null) => setRoute({ userId, view: "identities" }),
    [setRoute],
  );

  if (route.view === "menu") {
    return <RootMenu setView={setView} />;
  }
  if (route.userId !== null) {
    return (
      <IdentityDetailView
        onBack={() => selectIdentity(null)}
        userId={route.userId}
      />
    );
  }
  return <IdentitiesView onSelectIdentity={selectIdentity} />;
}

export function Root() {
  const { isAuthenticated, isRoot } = useCryptoSession();
  const { isRouted, route, setRoute } = useRootRoute();
  const compactRoutedMode = useCompactRoutedMode();
  const effectiveRoute: RootRoute =
    isRouted && !compactRoutedMode && route.view === "menu"
      ? IDENTITIES_ROOT_ROUTE
      : route;
  const setView = useCallback(
    (view: RootView) => setRoute(rootRouteForView(view)),
    [setRoute],
  );

  useRootSidebarPanel({ setView, view: effectiveRoute.view });

  return (
    <MiniAppRoot className="root-console">
      <main className="root-console-main">
        {isAuthenticated && isRoot ? (
          <RootContent route={effectiveRoute} setRoute={setRoute} />
        ) : (
          <RootAccessGate isAuthenticated={isAuthenticated} />
        )}
      </main>
    </MiniAppRoot>
  );
}
