import { MOBILE_BREAKPOINT_PX } from "./breakpoints";

export type AppNavigationMode = "routed" | "windowed";

export interface AppNavigationEnvironment {
  innerWidth: number;
  maxTouchPoints: number;
  pointerCoarse: boolean;
  userAgent: string;
}

interface ResolveAppNavigationModeInput {
  environment: AppNavigationEnvironment;
  forcedMode?: AppNavigationMode | undefined;
  mobileBreakpoint?: number | undefined;
}

function isIPadLikeEnvironment(environment: AppNavigationEnvironment): boolean {
  const userAgent = environment.userAgent.toLowerCase();
  return (
    userAgent.includes("ipad") ||
    (userAgent.includes("macintosh") && environment.maxTouchPoints > 1)
  );
}

export function resolveAppNavigationMode({
  environment,
  forcedMode,
  mobileBreakpoint = MOBILE_BREAKPOINT_PX,
}: ResolveAppNavigationModeInput): AppNavigationMode {
  if (forcedMode) {
    return forcedMode;
  }

  if (
    environment.innerWidth < mobileBreakpoint ||
    environment.pointerCoarse ||
    isIPadLikeEnvironment(environment)
  ) {
    return "routed";
  }

  return "windowed";
}
