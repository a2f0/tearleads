import { useCallback, useEffect, useRef, useState } from "react";
import {
  type MiniAppRouteSetOptions,
  useMiniAppRouteState,
} from "../../../navigation/useMiniAppRouteState";
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
    options?: MiniAppRouteSetOptions,
  ) => void;
  setSelectedGroupId: (
    groupId: string | null,
    options?: MiniAppRouteSetOptions,
  ) => void;
  setView: (view: OrgManagerView) => void;
}

type SetOrgManagerRoute = (
  nextRoute: OrgManagerRoute,
  options?: MiniAppRouteSetOptions,
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
    (groupId: string | null, options: MiniAppRouteSetOptions = {}) => {
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
      options: MiniAppRouteSetOptions = {},
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
  const [localRoute, setLocalRoute] = useState<OrgManagerRoute>(
    DEFAULT_ORG_MANAGER_ROUTE,
  );
  const { route, setRoute: setBaseRoute } = useMiniAppRouteState({
    appId: "org-manager",
    formatRouteSegments: formatOrgManagerRouteSegments,
    localRoute,
    parseRouteSegments: parseOrgManagerRouteSegments,
    setLocalRoute,
  });
  const routeRef = useRef(route);
  const selectedGroupIdRef = useRef(route.selectedGroupId);

  const setRoute: SetOrgManagerRoute = useCallback(
    (nextRoute: OrgManagerRoute, options: MiniAppRouteSetOptions = {}) => {
      routeRef.current = nextRoute;
      selectedGroupIdRef.current = nextRoute.selectedGroupId;
      setBaseRoute(nextRoute, options);
    },
    [setBaseRoute],
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
