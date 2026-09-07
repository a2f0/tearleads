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
import type { MiniAppRouteSetOptions } from "../../navigation/useMiniAppRouteState";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import "./Root.css";
import { IdentitiesView } from "./identities/IdentitiesView";
import { IdentityDetailView } from "./identities/IdentityDetailView";
import { OrganizationDetailView } from "./organizations/OrganizationDetailView";
import { OrganizationsView } from "./organizations/OrganizationsView";
import { RootMenu } from "./RootMenu";
import { useRootSidebarPanel } from "./RootSidebar";
import { DataUsageReportView } from "./reports/DataUsageReportView";
import {
  IDENTITIES_ROOT_ROUTE,
  ORGANIZATIONS_ROOT_ROUTE,
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
  setRoute: (route: RootRoute, options?: MiniAppRouteSetOptions) => void;
}) {
  const setView = useCallback(
    (view: RootView) => setRoute(rootRouteForView(view)),
    [setRoute],
  );
  const openIdentity = useCallback(
    (userId: string) =>
      setRoute({
        userId,
        view: "identities",
        ...(route.view === "organizations" && route.organizationId
          ? { returnOrganizationId: route.organizationId }
          : {}),
      }),
    [route, setRoute],
  );
  // Leaving the detail replaces the history entry rather than pushing the
  // list again, so the browser's Back does not reopen the detail just left.
  const closeIdentity = useCallback(
    () =>
      setRoute(
        route.view === "identities" && route.returnOrganizationId
          ? {
              view: "organizations",
              organizationId: route.returnOrganizationId,
              tab: "identities",
            }
          : IDENTITIES_ROOT_ROUTE,
        { replace: true },
      ),
    [route, setRoute],
  );

  const openOrganization = useCallback(
    (organizationId: string) =>
      setRoute({ view: "organizations", organizationId }),
    [setRoute],
  );
  const closeOrganization = useCallback(
    () => setRoute(ORGANIZATIONS_ROOT_ROUTE, { replace: true }),
    [setRoute],
  );

  if (route.view === "menu") {
    return <RootMenu setView={setView} />;
  }
  if (route.view === "reports") {
    return (
      <DataUsageReportView
        onSelectOrganization={(organizationId) =>
          setRoute({ view: "organizations", organizationId, tab: "data-usage" })
        }
      />
    );
  }
  if (route.view === "organizations") {
    return route.organizationId === null ? (
      <OrganizationsView onSelectOrganization={openOrganization} />
    ) : (
      <OrganizationDetailView
        key={route.organizationId}
        organizationId={route.organizationId}
        activeTab={route.tab ?? "overview"}
        onTabChange={(tab) => setRoute({ ...route, tab }, { replace: true })}
        onBack={closeOrganization}
        onSelectIdentity={openIdentity}
      />
    );
  }
  if (route.userId !== null) {
    return (
      <IdentityDetailView
        key={route.userId}
        onBack={closeIdentity}
        userId={route.userId}
        onSelectOrganization={openOrganization}
      />
    );
  }
  return <IdentitiesView onSelectIdentity={openIdentity} />;
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
