export type AppNavigationMode = "routed" | "windowed";

interface ResolveAppNavigationModeInput {
  forcedMode?: AppNavigationMode | undefined;
}

export function resolveAppNavigationMode({
  forcedMode,
}: ResolveAppNavigationModeInput): AppNavigationMode {
  return forcedMode ?? "routed";
}
