import {
  type MiniAppRouteSetOptions,
  useCompactRoutedMode,
} from "@tearleads/windowing";
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
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import "./Root.css";
import { AuditView } from "./audit/AuditView";
import { IdentitiesView } from "./identities/IdentitiesView";
import { IdentityDetailView } from "./identities/IdentityDetailView";
import { OrganizationDetailView } from "./organizations/OrganizationDetailView";
import { OrganizationsView } from "./organizations/OrganizationsView";
import { RootMenu } from "./RootMenu";
import { useRootSidebarPanel } from "./RootSidebar";
import { DataUsageReportView } from "./reports/DataUsageReportView";
import { OpsHealthReportView } from "./reports/OpsHealthReportView";
import {
  IDENTITIES_ROOT_ROUTE,
  type RootRoute,
  type RootView,
  rootRouteForView,
} from "./routes";
import { useRootNavigation } from "./useRootNavigation";
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
  const {
    openAudit,
    setView,
    openIdentity,
    closeIdentity,
    openOrganization,
    closeOrganization,
  } = useRootNavigation(route, setRoute);

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
    const openReportedOrganization =
      (tab: "billing" | "data-usage") => (organizationId: string) =>
        setRoute({
          view: "organizations",
          organizationId,
          tab,
          returnView: "reports",
        });
    return (
      <>
        <OpsHealthReportView
          onSelectOrganization={openReportedOrganization("billing")}
        />
        <DataUsageReportView
          onSelectOrganization={openReportedOrganization("data-usage")}
        />
      </>
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
        onShowAudit={openAudit}
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
        onShowAudit={openAudit}
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
