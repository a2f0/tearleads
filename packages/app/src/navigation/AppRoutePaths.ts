import type { MiniAppDefinition, MiniAppId } from "../mini-apps/types";

const APP_ROUTE_PREFIX = "/app/";

export interface AppRouteState {
  appId: MiniAppId | null;
  pathSegments: ReadonlyArray<string>;
}

function decodeRouteSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function isKnownMiniAppId(
  appId: string,
  miniApps: Readonly<Record<MiniAppId, MiniAppDefinition>>,
): appId is MiniAppId {
  return Object.hasOwn(miniApps, appId);
}

export function buildMiniAppPath(
  appId: MiniAppId,
  pathSegments: ReadonlyArray<string> = [],
): string {
  const encodedSegments = [
    encodeURIComponent(appId),
    ...pathSegments.map((segment) => encodeURIComponent(segment)),
  ];
  return `${APP_ROUTE_PREFIX}${encodedSegments.join("/")}`;
}

export function parseAppRoute(
  pathname: string,
  miniApps: Readonly<Record<MiniAppId, MiniAppDefinition>>,
): AppRouteState {
  if (!pathname.startsWith(APP_ROUTE_PREFIX)) {
    return { appId: null, pathSegments: [] };
  }

  const [encodedAppId = "", ...encodedPathSegments] = pathname
    .slice(APP_ROUTE_PREFIX.length)
    .split("/")
    .filter((segment) => segment.length > 0);
  const rawAppId = decodeRouteSegment(encodedAppId);
  if (!rawAppId || !isKnownMiniAppId(rawAppId, miniApps)) {
    return { appId: null, pathSegments: [] };
  }

  const pathSegments: string[] = [];
  for (const segment of encodedPathSegments) {
    const decodedSegment = decodeRouteSegment(segment);
    if (decodedSegment === null) {
      return { appId: rawAppId, pathSegments: [] };
    }
    pathSegments.push(decodedSegment);
  }

  return { appId: rawAppId, pathSegments };
}
