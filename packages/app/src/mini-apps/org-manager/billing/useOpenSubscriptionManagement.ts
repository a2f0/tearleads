import { useCallback } from "react";
import { useAppHostConfig } from "../../../providers/host/AppHostConfigProvider";

/**
 * Uses native store management when the shell supplies it, otherwise preserves
 * the provider URL behavior used by browsers and desktop targets.
 */
function openProviderSubscriptionManagement(managementUrl: string): void {
  window.open(managementUrl, "_blank", "noopener,noreferrer");
}

export function useOpenSubscriptionManagement(
  onNativeManagementClosed: () => void,
): (url: string) => void {
  const { openSubscriptionManagement } = useAppHostConfig();

  return useCallback(
    (managementUrl: string) => {
      if (!openSubscriptionManagement) {
        openProviderSubscriptionManagement(managementUrl);
        return;
      }
      void openSubscriptionManagement(managementUrl).then(
        onNativeManagementClosed,
        (error: unknown) => {
          console.error("Failed to open subscription management:", error);
          openProviderSubscriptionManagement(managementUrl);
        },
      );
    },
    [onNativeManagementClosed, openSubscriptionManagement],
  );
}
