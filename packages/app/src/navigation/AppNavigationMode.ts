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

const DEFAULT_MOBILE_BREAKPOINT = 1024;

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
  mobileBreakpoint = DEFAULT_MOBILE_BREAKPOINT,
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
