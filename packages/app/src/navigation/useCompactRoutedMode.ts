import { useAppNavigationState } from "./AppNavigationProvider";
import { useRoutedLayoutTier } from "./useRoutedLayoutTier";

export function useCompactRoutedMode(): boolean {
  const { mode } = useAppNavigationState();
  const tier = useRoutedLayoutTier();

  return mode === "routed" && tier === "mobile";
}
