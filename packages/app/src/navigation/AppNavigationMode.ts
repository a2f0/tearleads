import { DEMO_SPLIT_BREAKPOINT_PX } from "./breakpoints";

export type AppNavigationMode = "routed" | "windowed";

export interface AppNavigationEnvironment {
  innerWidth: number;
  maxTouchPoints: number;
  pointerCoarse: boolean;
  userAgent: string;
}

interface ResolveAppNavigationModeInput {
  environment?: AppNavigationEnvironment | undefined;
  forcedMode?: AppNavigationMode | undefined;
  preferWindowedPeerSplit?: boolean | undefined;
}

function isIPadLikeEnvironment(environment: AppNavigationEnvironment): boolean {
  const userAgent = environment.userAgent.toLowerCase();
  return (
    userAgent.includes("ipad") ||
    (userAgent.includes("macintosh") && environment.maxTouchPoints > 1)
  );
}

export function readAppNavigationEnvironment(): AppNavigationEnvironment {
  return {
    innerWidth: window.innerWidth,
    maxTouchPoints: navigator.maxTouchPoints,
    pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
    userAgent: navigator.userAgent,
  };
}

export function isWindowedLayoutEligible(
  environment: AppNavigationEnvironment,
): boolean {
  return (
    environment.innerWidth >= DEMO_SPLIT_BREAKPOINT_PX &&
    !environment.pointerCoarse &&
    !isIPadLikeEnvironment(environment)
  );
}

export function resolveAppNavigationMode({
  environment,
  forcedMode,
  preferWindowedPeerSplit = false,
}: ResolveAppNavigationModeInput): AppNavigationMode {
  if (forcedMode) {
    return forcedMode;
  }

  if (
    preferWindowedPeerSplit &&
    environment &&
    isWindowedLayoutEligible(environment)
  ) {
    return "windowed";
  }

  return "routed";
}
