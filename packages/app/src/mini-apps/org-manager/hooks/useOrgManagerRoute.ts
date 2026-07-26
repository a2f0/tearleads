import { useCallback, useEffect, useRef, useState } from "react";
import { useMiniAppRouteSegments } from "../../../navigation/AppNavigationProvider";
import {
  areOrgManagerRoutesEqual,
  DEFAULT_ORG_MANAGER_ROUTE,
  formatOrgManagerRouteSegments,
  type OrgManagerGrantRouteRef,
  type OrgManagerRoute,
  type OrgManagerView,
  parseOrgManagerRouteSegments,
  resolveOrgManagerRoute,
} from "../routes";

type OrgManagerGroupRouteTarget = {
  readonly groupId: string;
};

interface OrgManagerRouteState {
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  openGroupRoute: (groupId: string | null) => void;
  route: OrgManagerRoute;
  selectedGrantRef: OrgManagerGrantRouteRef | null;
  selectedGroupId: string | null;
  selectedGroupIdRef: { current: string | null };
  setSelectedGrantRef: (
    grantRef: OrgManagerGrantRouteRef | null,
    options?: { replace?: boolean | undefined },
  ) => void;
  setSelectedGroupId: (
    groupId: string | null,
    options?: { replace?: boolean | undefined },
  ) => void;
  setView: (view: OrgManagerView) => void;
}

type SetOrgManagerRoute = (
  nextRoute: OrgManagerRoute,
  options?: { replace?: boolean | undefined },
) => void;

function useOrgManagerRouteActions(
  routeRef: { current: OrgManagerRoute },
  setRoute: SetOrgManagerRoute,
) {
  const setView = useCallback(
    (view: OrgManagerView) => {
      setRoute({ ...routeRef.current, selectedGrantRef: null, view });
    },
    [routeRef, setRoute],
  );

  const setSelectedGroupId = useCallback(
    (
      groupId: string | null,
      options: { replace?: boolean | undefined } = {},
    ) => {
      setRoute(
        {
          ...routeRef.current,
          selectedGrantRef: null,
          selectedGroupId: groupId,
        },
        options,
      );
    },
    [routeRef, setRoute],
  );

  const setSelectedGrantRef = useCallback(
    (
      grantRef: OrgManagerGrantRouteRef | null,
      options: { replace?: boolean | undefined } = {},
    ) => {
      setRoute(
        {
          ...routeRef.current,
          selectedGrantRef: grantRef,
          selectedGroupId: null,
          view: "grants",
        },
        options,
      );
    },
    [routeRef, setRoute],
  );

  const openGroupRoute = useCallback(
    (groupId: string | null) => {
      setRoute({
        selectedGrantRef: null,
        selectedGroupId: groupId,
        view: "groups",
      });
    },
    [setRoute],
  );

  const openGrantRoute = useCallback(
    (grantRef: OrgManagerGrantRouteRef) => {
      setRoute({
        selectedGrantRef: grantRef,
        selectedGroupId: null,
        view: "grants",
      });
    },
    [setRoute],
  );

  return {
    openGrantRoute,
    openGroupRoute,
    setSelectedGrantRef,
    setSelectedGroupId,
    setView,
  };
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

  const setRoute: SetOrgManagerRoute = useCallback(
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

  const routeActions = useOrgManagerRouteActions(routeRef, setRoute);

  return {
    ...routeActions,
    route,
    selectedGrantRef: route.selectedGrantRef,
    selectedGroupId: route.selectedGroupId,
    selectedGroupIdRef,
  };
}
