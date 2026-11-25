import { useEffect } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { useLog } from "../../../providers/logging/LogProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { useTearleadsStoreSnapshot } from "../../../providers/sdk/useTearleadsSubscription";
import { useMiniAppBusActions } from "../../bus";
import { ORG_MANAGER_LABELS } from "../labels";

/**
 * Whether the organization refuses this session until it passes a second
 * factor. The status loads once per session token; turning two-factor on
 * updates it in place.
 */
function useOrganizationTwoFactorRequired(
  organizationId: string,
  signedIn: boolean,
): boolean {
  const tearleads = useTearleads();
  const { logError } = useLog();
  const status = useTearleadsStoreSnapshot(tearleads.twoFactor);
  const { authToken } = useTearleadsStoreSnapshot(tearleads.session);

  useEffect(() => {
    if (!signedIn || !authToken || status !== null) return;
    tearleads.twoFactor.status().catch((error: unknown) => {
      logError("Failed to load two-factor status", error);
    });
  }, [authToken, logError, signedIn, status, tearleads]);

  return Boolean(status?.requiredByOrganizationIds.includes(organizationId));
}

/** Explains a refusal by the organization's two-factor requirement. */
export function OrganizationTwoFactorNotice({
  organizationId,
  signedIn,
}: {
  readonly organizationId: string;
  readonly signedIn: boolean;
}) {
  const required = useOrganizationTwoFactorRequired(organizationId, signedIn);
  const { openMiniApp } = useMiniAppBusActions();
  if (!required) return null;

  return (
    <div className="org-manager-two-factor-notice">
      <MiniAppStatus role="alert" tone="error">
        {ORG_MANAGER_LABELS.twoFactorRequiredNotice}
      </MiniAppStatus>
      <MiniAppToolbar>
        <MiniAppButton
          onClick={() =>
            openMiniApp({
              appId: "identity-manager",
              pathSegments: ["two-factor"],
            })
          }
          type="button"
        >
          {ORG_MANAGER_LABELS.twoFactorSetUpAction}
        </MiniAppButton>
      </MiniAppToolbar>
    </div>
  );
}
