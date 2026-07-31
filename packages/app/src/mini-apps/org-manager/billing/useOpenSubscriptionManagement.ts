import { useCallback } from "react";
import { useAppHostConfig } from "../../../providers/host/AppHostConfigProvider";

/**
 * Uses native store management when the shell supplies it, otherwise preserves
 * the provider URL behavior used by browsers and desktop targets.
 */
export function useOpenSubscriptionManagement(): (url: string) => void {
  const { openSubscriptionManagement } = useAppHostConfig();

  return useCallback(
    (managementUrl: string) => {
      if (!openSubscriptionManagement) {
        window.open(managementUrl, "_blank", "noopener,noreferrer");
        return;
      }
      void openSubscriptionManagement(managementUrl).catch((error: unknown) => {
        console.error("Failed to open subscription management:", error);
      });
    },
    [openSubscriptionManagement],
  );
}
