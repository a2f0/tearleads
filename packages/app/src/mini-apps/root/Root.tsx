import {
  type MiniAppRouteSetOptions,
  useCompactRoutedMode,
  useMiniAppRouteSegments,
  useWindowToolbarReservation,
} from "@tearleads/windowing";
import { useCallback } from "react";
import { AccountBootstrapPanel } from "../../components/identity/AccountBootstrapPanel";
import {
  MiniAppRoot,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import "./Root.css";
import { AuditView } from "./audit/AuditView";
import { IdentitiesView } from "./identities/IdentitiesView";
import { IdentityDetailView } from "./identities/IdentityDetailView";
import { OrganizationDetailView } from "./organizations/OrganizationDetailView";
import { OrganizationsView } from "./organizations/OrganizationsView";
import { RootMenu } from "./RootMenu";
import { useRootRoutedChromeActions } from "./RootRoutedChrome";
import { useRootSidebarPanel } from "./RootSidebar";
import { ReportsView } from "./reports/ReportsView";
import { RootReportView } from "./reports/RootReportView";
import {
  IDENTITIES_ROOT_ROUTE,
  type RootRoute,
  type RootView,
  rootRouteForView,
} from "./routes";
import { useRootNavigation } from "./useRootNavigation";
import { useRootRoute } from "./useRootRoute";

function RootAccessGate({ isAuthenticated }: { isAuthenticated: boolean }) {
  if (!isAuthenticated) {
    return (
      <AccountBootstrapPanel
        signedOutDescription="Platform operators manage identities, organizations, and reports here."
        signedOutTitle="Log in to use the root console"
      />
    );
  }

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Root</h2>
      </MiniAppSectionHeading>
      <MiniAppStatus>
        This identity is not a platform operator. Root access is granted on the
        server with the API CLI.
      </MiniAppStatus>
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
  const { openAudit, openIdentity, openOrganization, openReport, setView } =
    useRootNavigation(route, setRoute);
  // Ask the host, not the global router: in a window this is the window's own
  // Back stack, in the routed shell it is browser history.
  const { canGoBack } = useMiniAppRouteSegments("root");
  useRootRoutedChromeActions({
    historyCanGoBack: canGoBack,
    openAudit,
    route,
    setRoute,
  });

  if (route.view === "menu") {
    return <RootMenu setView={setView} />;
  }
  if (route.view === "audit") {
    return (
      <AuditView
        subjectId={route.subjectId}
        onSubjectChange={(subjectId) =>
          setRoute({ subjectId, view: "audit" }, { replace: true })
        }
        onSelectIdentity={openIdentity}
        onSelectOrganization={openOrganization}
      />
    );
  }
  if (route.view === "reports") {
    return route.reportId === null ? (
      <ReportsView onSelectReport={openReport} />
    ) : (
      <RootReportView
        key={route.reportId}
        reportId={route.reportId}
        onSelectIdentity={openIdentity}
        onSelectOrganization={openOrganization}
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
        onSelectIdentity={openIdentity}
      />
    );
  }
  if (route.userId !== null) {
    return (
      <IdentityDetailView
        key={route.userId}
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
  // A toolbar row on every console route, blank where a route has no action,
  // so it does not appear and collapse as the operator moves between views.
  const showConsole = isAuthenticated && isRoot;
  useWindowToolbarReservation(showConsole);

  return (
    <MiniAppRoot className="root-console">
      <main className="root-console-main">
        {showConsole ? (
          <RootContent route={effectiveRoute} setRoute={setRoute} />
        ) : (
          <RootAccessGate isAuthenticated={isAuthenticated} />
        )}
      </main>
    </MiniAppRoot>
  );
}
