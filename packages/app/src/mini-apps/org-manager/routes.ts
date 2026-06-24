export type OrgManagerView =
  | "directory"
  | "groups"
  | "grants"
  | "organization"
  | "usage";

export interface OrgManagerRoute {
  selectedGrantRef: OrgManagerGrantRouteRef | null;
  selectedGroupId: string | null;
  view: OrgManagerView;
}

export const DEFAULT_ORG_MANAGER_ROUTE: OrgManagerRoute = {
  selectedGrantRef: null,
  selectedGroupId: null,
  view: "directory",
};

export type OrgManagerGrantSubjectType = "group" | "organization" | "user";

export interface OrgManagerGrantRouteRef {
  containerId: string;
  subjectId: string;
  subjectType: OrgManagerGrantSubjectType;
}

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
  const fourthSegment = pathSegments[3];
  if (!viewSegment) {
    return DEFAULT_ORG_MANAGER_ROUTE;
  }

  if (!isOrgManagerView(viewSegment)) {
    return DEFAULT_ORG_MANAGER_ROUTE;
  }

  if (viewSegment === "groups") {
    return {
      selectedGrantRef: null,
      selectedGroupId: secondSegment ?? null,
      view: "groups",
    };
  }

  if (viewSegment === "grants" && secondSegment === "detail") {
    return {
      selectedGrantRef:
        isOrgManagerGrantSubjectType(thirdSegment) &&
        fourthSegment &&
        pathSegments[4]
          ? {
              containerId: pathSegments[4],
              subjectId: fourthSegment,
              subjectType: thirdSegment,
            }
          : null,
      selectedGroupId: null,
      view: "grants",
    };
  }

  return {
    selectedGrantRef: null,
    selectedGroupId: secondSegment === "groups" ? (thirdSegment ?? null) : null,
    view: viewSegment,
  };
}

export function formatOrgManagerRouteSegments({
  selectedGrantRef,
  selectedGroupId,
  view,
}: OrgManagerRoute): ReadonlyArray<string> {
  if (
    view === DEFAULT_ORG_MANAGER_ROUTE.view &&
    !selectedGroupId &&
    !selectedGrantRef
  ) {
    return [];
  }

  if (view === "groups") {
    return selectedGroupId ? ["groups", selectedGroupId] : ["groups"];
  }

  if (view === "grants" && selectedGrantRef) {
    return [
      "grants",
      "detail",
      selectedGrantRef.subjectType,
      selectedGrantRef.subjectId,
      selectedGrantRef.containerId,
    ];
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
    left.view === right.view &&
    left.selectedGroupId === right.selectedGroupId &&
    areOrgManagerGrantRouteRefsEqual(
      left.selectedGrantRef,
      right.selectedGrantRef,
    )
  );
}

function isOrgManagerGrantSubjectType(
  subjectType: string | undefined,
): subjectType is OrgManagerGrantSubjectType {
  return (
    subjectType === "group" ||
    subjectType === "organization" ||
    subjectType === "user"
  );
}

function areOrgManagerGrantRouteRefsEqual(
  left: OrgManagerGrantRouteRef | null,
  right: OrgManagerGrantRouteRef | null,
): boolean {
  if (left === right) {
    return true;
  }

  return (
    Boolean(left) &&
    Boolean(right) &&
    left?.containerId === right?.containerId &&
    left?.subjectId === right?.subjectId &&
    left?.subjectType === right?.subjectType
  );
}
