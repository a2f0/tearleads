import { useCallback, useEffect, useRef, useState } from "react";
import { useMiniAppRouteSegments } from "../../../navigation/AppNavigationProvider";
import {
  areOrgManagerRoutesEqual,
  DEFAULT_ORG_MANAGER_ROUTE,
  formatOrgManagerRouteSegments,
  type OrgManagerRoute,
  type OrgManagerView,
  parseOrgManagerRouteSegments,
  resolveOrgManagerRoute,
} from "../routes";

type OrgManagerGroupRouteTarget = {
  readonly groupId: string;
};

interface OrgManagerRouteState {
  openGroupRoute: (groupId: string | null) => void;
  route: OrgManagerRoute;
  selectedGroupId: string | null;
  selectedGroupIdRef: { current: string | null };
  setSelectedGroupId: (groupId: string | null) => void;
  setView: (view: OrgManagerView) => void;
}

export function useOrgManagerRoute(params: {
  groups: ReadonlyArray<OrgManagerGroupRouteTarget>;
}): OrgManagerRouteState {
  const { groups } = params;
  const appRoute = useMiniAppRouteSegments("org-manager");
  const { isRouted, pathSegments, setPathSegments } = appRoute;
  const [localRoute, setLocalRoute] = useState<OrgManagerRoute>(
    DEFAULT_ORG_MANAGER_ROUTE,
  );
  const route = isRouted
    ? parseOrgManagerRouteSegments(pathSegments)
    : localRoute;
  const routeRef = useRef(route);
  const selectedGroupIdRef = useRef(route.selectedGroupId);

  const setRoute = useCallback(
    (
      nextRoute: OrgManagerRoute,
      options: { replace?: boolean | undefined } = {},
    ) => {
      routeRef.current = nextRoute;
      selectedGroupIdRef.current = nextRoute.selectedGroupId;
      if (isRouted) {
        setPathSegments(formatOrgManagerRouteSegments(nextRoute), options);
        return;
      }

      setLocalRoute(nextRoute);
    },
    [isRouted, setPathSegments],
  );

  useEffect(() => {
    routeRef.current = route;
    selectedGroupIdRef.current = route.selectedGroupId;
  }, [route]);

  useEffect(() => {
    const nextRoute = resolveOrgManagerRoute(route, groups);
    if (!areOrgManagerRoutesEqual(route, nextRoute)) {
      setRoute(nextRoute, { replace: true });
    }
  }, [groups, route, setRoute]);

  const setView = useCallback(
    (view: OrgManagerView) => {
      setRoute({ ...routeRef.current, view });
    },
    [setRoute],
  );

  const setSelectedGroupId = useCallback(
    (groupId: string | null) => {
      setRoute({ ...routeRef.current, selectedGroupId: groupId });
    },
    [setRoute],
  );

  const openGroupRoute = useCallback(
    (groupId: string | null) => {
      setRoute({ selectedGroupId: groupId, view: "groups" });
    },
    [setRoute],
  );

  return {
    openGroupRoute,
    route,
    selectedGroupId: route.selectedGroupId,
    selectedGroupIdRef,
    setSelectedGroupId,
    setView,
  };
}
