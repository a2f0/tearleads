import type { OrganizationBillingManagementUrl } from "@tearleads/client-sdk";
import { useCallback, useState } from "react";
import { useAppHostConfig } from "../../../providers/host/AppHostConfigProvider";
import { useLog } from "../../../providers/logging/LogProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { ORG_MANAGER_LABELS } from "../labels";
import { useScopedOrganizationLoad } from "./useScopedOrganizationLoad";

type ManagementUrlSnapshot = Pick<
  OrganizationBillingManagementUrl,
  "managementUrl"
>;

const NO_MANAGEMENT_URL: ManagementUrlSnapshot = {
  managementUrl: null,
};

/**
 * Loads the active organization's subscription-management URL through the SDK
 * facade so an admin can open the provider's manage/cancel page. The server
 * resolves the URL from the organization's stored customer id, so it works for
 * ANY admin — not just the buyer whose device holds the subscription. `enabled`
 * gates the fetch (only for admins of an org that has a provider-managed
 * subscription). `reloadToken` re-fetches when it changes — pass the billing
 * snapshot so a billing refresh keeps the link current. Both a load error and a
 * "no managed subscription" resolve to a null URL, which hides the manage button
 * rather than surfacing an error for what is only a convenience link.
 */
export function useBillingManagementUrl(
  organizationId: string,
  enabled: boolean,
  reloadToken?: unknown,
): ManagementUrlSnapshot {
  const tearleads = useTearleads();
  const { logError } = useLog();
  const snapshot = useScopedOrganizationLoad<ManagementUrlSnapshot>({
    enabled,
    load: async () => {
      try {
        const result = await tearleads.organizations.loadBillingManagementUrl();
        return {
          managementUrl: result?.managementUrl ?? null,
        };
      } catch (loadError) {
        // A background read: offline, the fetch failure is expected, not a
        // defect worth a diagnostics event.
        if (tearleads.network.online) {
          logError("Failed to load billing management URL", loadError);
        }
        return NO_MANAGEMENT_URL;
      }
    },
    organizationId,
    reloadToken,
    source: tearleads,
    whenDisabled: NO_MANAGEMENT_URL,
  });

  // Scope the URL to the requesting org so a stale value never leaks across an
  // org switch before the new fetch resolves.
  return snapshot ?? NO_MANAGEMENT_URL;
}

function openProviderSubscriptionManagement(managementUrl: string): void {
  window.open(managementUrl, "_blank", "noopener,noreferrer");
}

/** Opens the shell's native subscription UI, falling back to the provider URL. */
export function useOpenSubscriptionManagement(
  onNativeManagementClosed: () => void,
): {
  readonly error: string | null;
  readonly open: (url: string) => void;
} {
  const { openSubscriptionManagement } = useAppHostConfig();
  const { logError } = useLog();
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
          if (result === "native-closed") onNativeManagementClosed();
        },
        (cause: unknown) => {
          logError("Failed to open subscription management", cause);
          setError(ORG_MANAGER_LABELS.billingManageSubscriptionFailed);
        },
      );
    },
    [logError, onNativeManagementClosed, openSubscriptionManagement],
  );
  return { error, open };
}
