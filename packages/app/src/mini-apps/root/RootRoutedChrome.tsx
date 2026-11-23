import { ClipboardTextIcon } from "@phosphor-icons/react/dist/csr/ClipboardText";
import {
  type MiniAppRouteSetOptions,
  useWindowTitleBarAction,
} from "@tearleads/windowing";
import { useMiniAppDetailBackAction } from "../../components/mini-app/useMiniAppDetailBackAction";
import { chromeOwnsRouteBackedDetailBack } from "../../navigation/routeBackedDetailBack";
import type { RootRoute } from "./routes";
import { rootDetailParentRoute } from "./useRootNavigation";

// Module-level so an unchanged action matches its registration structurally.
const AUDIT_ICON = <ClipboardTextIcon aria-hidden size={18} />;

/** The identity or organization a detail route shows, for its audit trail. */
function rootAuditSubjectId(route: RootRoute): string | null {
  if (route.view === "identities") return route.userId;
  if (route.view === "organizations") return route.organizationId;
  return null;
}

/**
 * Registers the root console's window toolbar chrome, as Explorer and Org
 * Manager do: the detail Back and the Audit activity action live in the
 * toolbar rather than as buttons in each view. Each view registers its own
 * Refresh with {@link useWindowRefreshMenuItem}.
 *
 * Every detail here is route-backed, so where the host can step back (browser
 * history in the routed shell, the window's own Back stack in a window) its
 * Back already leaves the detail; this registers a Back only when there is
 * nothing to pop, and that fallback replaces the detail with its parent. See
 * {@link chromeOwnsRouteBackedDetailBack}.
 */
export function useRootRoutedChromeActions({
  historyCanGoBack,
  openAudit,
  route,
  setRoute,
}: {
  /** Whether the host can step back: `useMiniAppRouteSegments().canGoBack`. */
  historyCanGoBack: boolean;
  openAudit: (subjectId: string) => void;
  route: RootRoute;
  setRoute: (route: RootRoute, options?: MiniAppRouteSetOptions) => void;
}) {
  const parentRoute = chromeOwnsRouteBackedDetailBack({ historyCanGoBack })
    ? rootDetailParentRoute(route)
    : null;
  useMiniAppDetailBackAction(
    parentRoute
      ? {
          label: "Back",
          onBack: () => setRoute(parentRoute, { replace: true }),
        }
      : null,
  );

  const auditSubjectId = rootAuditSubjectId(route);
  useWindowTitleBarAction(
    auditSubjectId
      ? {
          icon: AUDIT_ICON,
          id: "root-audit-activity",
          label: "Audit activity",
          onClick: () => openAudit(auditSubjectId),
          priority: 100,
        }
      : null,
  );
}
