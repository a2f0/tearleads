import type { SyncSubscriptionOption } from "@tearleads/client-sdk";
import { useCallback, useEffect, useState } from "react";
import { usePurchases } from "../../../providers/purchases/PurchasesProvider";
import type { BillingBusyAction } from "../BillingView";
import { ORG_MANAGER_LABELS } from "../labels";

interface BillingActions {
  readonly purchaseAvailable: boolean;
  readonly canSubscribe: boolean;
  readonly options: ReadonlyArray<SyncSubscriptionOption>;
  readonly busy: BillingBusyAction | null;
  readonly actionError: string | null;
  readonly activationPending: boolean;
  readonly startTrial: () => void;
  readonly subscribe: (option: SyncSubscriptionOption) => void;
  readonly restore: () => void;
}

/**
 * Owns the billing panel's in-flight action state and orchestrates the platform
 * purchases capability (list options, identify + purchase, restore), refetching
 * billing afterwards. Trial start is delegated to the billing snapshot hook.
 */
export function useBillingActions({
  billingCanSync,
  isOrgAdmin,
  organizationId,
  refresh,
  startTrial: startTrialRequest,
  userId,
}: {
  billingCanSync: boolean;
  isOrgAdmin: boolean;
  organizationId: string;
  refresh: () => Promise<void>;
  startTrial: () => Promise<boolean>;
  userId: string | null;
}): BillingActions {
  const purchases = usePurchases();
  const [options, setOptions] = useState<ReadonlyArray<SyncSubscriptionOption>>(
    [],
  );
  const [busy, setBusy] = useState<BillingBusyAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activationPending, setActivationPending] = useState(false);

  const canSubscribe = isOrgAdmin && purchases.isAvailable && userId !== null;

  useEffect(() => {
    setActivationPending(false);
  }, [organizationId]);

  useEffect(() => {
    if (billingCanSync) {
      setActivationPending(false);
    }
  }, [billingCanSync]);

  useEffect(() => {
    if (!canSubscribe) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    void purchases
      .listSyncOptions()
      .then((next) => {
        if (!cancelled) {
          setOptions(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOptions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canSubscribe, purchases]);

  const startTrial = useCallback(() => {
    setBusy("trial");
    setActionError(null);
    void startTrialRequest().finally(() => setBusy(null));
  }, [startTrialRequest]);

  const subscribe = useCallback(
    (option: SyncSubscriptionOption) => {
      if (!canSubscribe || userId === null) {
        return;
      }
      setBusy(`subscribe:${option.packageId}`);
      setActionError(null);
      void (async () => {
        try {
          await purchases.identify({ userId });
          const result = await purchases.purchaseSync({
            organizationId,
            packageId: option.packageId,
          });
          if (!result.syncEntitlementActive) {
            setActionError(ORG_MANAGER_LABELS.failedSubscribe);
            return;
          }
          setActivationPending(true);
          await refresh();
        } catch {
          setActionError(ORG_MANAGER_LABELS.failedSubscribe);
        } finally {
          setBusy(null);
        }
      })();
    },
    [canSubscribe, organizationId, purchases, refresh, userId],
  );

  const restore = useCallback(() => {
    setBusy("restore");
    setActionError(null);
    void (async () => {
      try {
        await purchases.restore();
        await refresh();
      } catch {
        setActionError(ORG_MANAGER_LABELS.failedRestorePurchases);
      } finally {
        setBusy(null);
      }
    })();
  }, [purchases, refresh]);

  return {
    purchaseAvailable: purchases.isAvailable,
    canSubscribe,
    options,
    busy,
    actionError,
    activationPending,
    startTrial,
    subscribe,
    restore,
  };
}
