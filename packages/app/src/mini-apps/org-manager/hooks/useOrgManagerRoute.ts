import { useCallback, useEffect, useRef, useState } from "react";
import {
  areOrgManagerRoutesEqual,
  DEFAULT_ORG_MANAGER_ROUTE,
  type OrgManagerRoute,
  type OrgManagerView,
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
  const [route, setRouteState] = useState<OrgManagerRoute>(
    DEFAULT_ORG_MANAGER_ROUTE,
  );
  const routeRef = useRef(route);
  const selectedGroupIdRef = useRef(route.selectedGroupId);

  const setRoute = useCallback((nextRoute: OrgManagerRoute) => {
    routeRef.current = nextRoute;
    selectedGroupIdRef.current = nextRoute.selectedGroupId;
    setRouteState(nextRoute);
  }, []);

  useEffect(() => {
    const nextRoute = resolveOrgManagerRoute(route, groups);
    if (!areOrgManagerRoutesEqual(route, nextRoute)) {
      setRoute(nextRoute);
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
