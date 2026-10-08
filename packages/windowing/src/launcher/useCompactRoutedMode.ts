import { useOptionalLauncherNavigationState } from "./LauncherNavigationProvider";
import { useRoutedLayoutTier } from "./useRoutedLayoutTier";

/** Whether the routed shell is on screen at its phone tier. */
export function useCompactRoutedMode(): boolean {
  const navigation = useOptionalLauncherNavigationState();
  const tier = useRoutedLayoutTier();

  return navigation?.mode === "routed" && tier === "mobile";
}
