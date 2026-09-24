import {
  type AppNavigationMode,
  resolveAppNavigationMode,
} from "./AppNavigationMode";

/**
 * A manual choice wins over the host mode; otherwise the routed shell is the
 * default.
 */
export function useAppNavigationMode(
  forcedMode?: AppNavigationMode | undefined,
  override?: AppNavigationMode | null | undefined,
): AppNavigationMode {
  return resolveAppNavigationMode({ forcedMode: override ?? forcedMode });
}
