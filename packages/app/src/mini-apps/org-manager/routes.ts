export type OrgManagerView =
  | "directory"
  | "groups"
  | "grants"
  | "organization"
  | "usage";

export interface OrgManagerRoute {
  selectedGroupId: string | null;
  view: OrgManagerView;
}

export const DEFAULT_ORG_MANAGER_ROUTE: OrgManagerRoute = {
  selectedGroupId: null,
  view: "directory",
};

type OrgManagerGroupRouteTarget = {
  readonly groupId: string;
};

function isOrgManagerView(view: string | undefined): view is OrgManagerView {
  return (
    view === "directory" ||
    view === "groups" ||
    view === "grants" ||
    view === "organization" ||
    view === "usage"
  );
}

export function parseOrgManagerRouteSegments(
  pathSegments: ReadonlyArray<string>,
): OrgManagerRoute {
  const [viewSegment, secondSegment, thirdSegment] = pathSegments;
  if (!viewSegment) {
    return DEFAULT_ORG_MANAGER_ROUTE;
  }

  if (!isOrgManagerView(viewSegment)) {
    return DEFAULT_ORG_MANAGER_ROUTE;
  }

  if (viewSegment === "groups") {
    return { selectedGroupId: secondSegment ?? null, view: "groups" };
  }

  return {
    selectedGroupId: secondSegment === "groups" ? (thirdSegment ?? null) : null,
    view: viewSegment,
  };
}

export function formatOrgManagerRouteSegments({
  selectedGroupId,
  view,
}: OrgManagerRoute): ReadonlyArray<string> {
  if (view === DEFAULT_ORG_MANAGER_ROUTE.view && !selectedGroupId) {
    return [];
  }

  if (view === "groups") {
    return selectedGroupId ? ["groups", selectedGroupId] : ["groups"];
  }

  return selectedGroupId ? [view, "groups", selectedGroupId] : [view];
}

export function resolveOrgManagerSelectedGroupId(
  selectedGroupId: string | null,
  groups: ReadonlyArray<OrgManagerGroupRouteTarget>,
): string | null {
  if (
    selectedGroupId &&
    groups.some((group) => group.groupId === selectedGroupId)
  ) {
    return selectedGroupId;
  }

  return null;
}

export function resolveOrgManagerRoute(
  route: OrgManagerRoute,
  groups: ReadonlyArray<OrgManagerGroupRouteTarget>,
): OrgManagerRoute {
  if (groups.length === 0) {
    return route;
  }

  const selectedGroupId = resolveOrgManagerSelectedGroupId(
    route.selectedGroupId,
    groups,
  );

  return selectedGroupId === route.selectedGroupId
    ? route
    : { ...route, selectedGroupId };
}

export function areOrgManagerRoutesEqual(
  left: OrgManagerRoute,
  right: OrgManagerRoute,
): boolean {
  return (
    left.view === right.view && left.selectedGroupId === right.selectedGroupId
  );
}
