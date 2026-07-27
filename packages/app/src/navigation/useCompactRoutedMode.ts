import { useOptionalAppNavigationState } from "./AppNavigationProvider";
import { useRoutedLayoutTier } from "./useRoutedLayoutTier";

export function useCompactRoutedMode(): boolean {
  const navigation = useOptionalAppNavigationState();
  const tier = useRoutedLayoutTier();

  return navigation?.mode === "routed" && tier === "mobile";
}
