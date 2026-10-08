import { isLauncherAppId, type LauncherDefinition } from "./launcherDefinition";

export const LAUNCHER_HOME_PATH = "/";
const LAUNCHER_ROUTE_PREFIX = "/app/";

/**
 * Where the routed shell is: the app it shows (or `null` at the root route)
 * and the app's own path within it.
 */
export interface LauncherRoute<AppId extends string = string> {
  appId: AppId | null;
  pathSegments: ReadonlyArray<string>;
}

function decodeRouteSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The URL of an app's route: `/app/<app id>/<path segments…>`. */
export function buildMiniAppPath(
  appId: string,
  pathSegments: ReadonlyArray<string> = [],
): string {
  const encodedSegments = [
    encodeURIComponent(appId),
    ...pathSegments.map((segment) => encodeURIComponent(segment)),
  ];
  return `${LAUNCHER_ROUTE_PREFIX}${encodedSegments.join("/")}`;
}

/**
 * Reads a URL path back into a route. Paths outside `/app/`, and apps the
 * launcher does not have, read as the root route.
 */
export function parseLauncherRoute<AppId extends string>(
  pathname: string,
  definition: LauncherDefinition<AppId>,
): LauncherRoute<AppId> {
  if (!pathname.startsWith(LAUNCHER_ROUTE_PREFIX)) {
    return { appId: null, pathSegments: [] };
  }

  const [encodedAppId = "", ...encodedPathSegments] = pathname
    .slice(LAUNCHER_ROUTE_PREFIX.length)
    .split("/")
    .filter((segment) => segment.length > 0);
  const rawAppId = decodeRouteSegment(encodedAppId);
  if (!isLauncherAppId(definition, rawAppId)) {
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
