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
