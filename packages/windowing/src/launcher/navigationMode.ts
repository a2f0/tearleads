import { WINDOWED_LAYOUT_MIN_WIDTH_PX } from "./breakpoints";

/**
 * How a launcher presents its apps: `windowed` as movable windows on a desktop,
 * or `routed` as one app at a time in the routed shell, the iPad / phone
 * layout, with browser history for navigation.
 */
export type NavigationMode = "routed" | "windowed";

export interface NavigationEnvironment {
  innerWidth: number;
  maxTouchPoints: number;
  pointerCoarse: boolean;
  userAgent: string;
}

interface ResolveNavigationModeInput {
  environment?: NavigationEnvironment | undefined;
  /** A mode that wins over `preferredMode`, such as a host's fixed layout. */
  forcedMode?: NavigationMode | undefined;
  /**
   * The mode to use when nothing forces one. `windowed` applies only while the
   * environment can show windows (see {@link isWindowedLayoutEligible}).
   * Defaults to `routed`.
   */
  preferredMode?: NavigationMode | undefined;
}

function isIPadLikeEnvironment(environment: NavigationEnvironment): boolean {
  const userAgent = environment.userAgent.toLowerCase();
  return (
    userAgent.includes("ipad") ||
    (userAgent.includes("macintosh") && environment.maxTouchPoints > 1)
  );
}

export function readNavigationEnvironment(): NavigationEnvironment {
  return {
    innerWidth: window.innerWidth,
    maxTouchPoints: navigator.maxTouchPoints,
    pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
    userAgent: navigator.userAgent,
  };
}

/**
 * Whether windows suit the environment: a desktop-width screen with a fine
 * pointer, and not an iPad, which reports a desktop user agent.
 */
export function isWindowedLayoutEligible(
  environment: NavigationEnvironment,
): boolean {
  return (
    environment.innerWidth >= WINDOWED_LAYOUT_MIN_WIDTH_PX &&
    !environment.pointerCoarse &&
    !isIPadLikeEnvironment(environment)
  );
}

export function resolveNavigationMode({
  environment,
  forcedMode,
  preferredMode = "routed",
}: ResolveNavigationModeInput): NavigationMode {
  if (forcedMode) {
    return forcedMode;
  }

  if (
    preferredMode === "windowed" &&
    environment &&
    isWindowedLayoutEligible(environment)
  ) {
    return "windowed";
  }

  return "routed";
}
