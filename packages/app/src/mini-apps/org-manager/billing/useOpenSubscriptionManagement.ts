import { useCallback, useState } from "react";
import { useAppHostConfig } from "../../../providers/host/AppHostConfigProvider";
import { ORG_MANAGER_LABELS } from "../labels";

function openProviderSubscriptionManagement(managementUrl: string): void {
  window.open(managementUrl, "_blank", "noopener,noreferrer");
}

/**
 * Uses native store management when the shell supplies it, otherwise preserves
 * the provider URL behavior used by browsers and desktop targets.
 */
export function useOpenSubscriptionManagement(
  onNativeManagementClosed: () => void,
): {
  readonly error: string | null;
  readonly open: (url: string) => void;
} {
  const { openSubscriptionManagement } = useAppHostConfig();
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(
    (managementUrl: string) => {
      setError(null);
      if (!openSubscriptionManagement) {
        openProviderSubscriptionManagement(managementUrl);
        return;
      }
      void openSubscriptionManagement(managementUrl).then(
        (result) => {
          if (result === "native-closed") {
            onNativeManagementClosed();
          }
        },
        (error: unknown) => {
          console.error("Failed to open subscription management:", error);
          setError(ORG_MANAGER_LABELS.billingManageSubscriptionFailed);
        },
      );
    },
    [onNativeManagementClosed, openSubscriptionManagement],
  );
  return { error, open };
}
