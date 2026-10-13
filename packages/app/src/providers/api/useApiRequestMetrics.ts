import { useIdentity } from "../identity/IdentityProvider";
import { useTearleads } from "../sdk/TearleadsProvider";
import { useTearleadsExternalValue } from "../sdk/useTearleadsSubscription";

export function useApiRequestMetrics() {
  const { apiRequests } = useTearleads();
  const { signingFingerprint } = useIdentity();
  const snapshot = useTearleadsExternalValue(apiRequests.subscribe, () =>
    apiRequests.getSnapshot(signingFingerprint),
  );
  return {
    snapshot,
    hasIdentity: signingFingerprint !== null,
    reset: () => apiRequests.reset(signingFingerprint),
  };
}
