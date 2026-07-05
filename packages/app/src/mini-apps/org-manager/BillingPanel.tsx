import { useCallback } from "react";
import { BillingView } from "./BillingView";
import { useBillingActions } from "./hooks/useBillingActions";
import { useOrganizationBilling } from "./hooks/useOrganizationBilling";

/**
 * Container for the org-manager billing view: wires the billing snapshot
 * ({@link useOrganizationBilling}) and the purchase orchestration
 * ({@link useBillingActions}). The presentational {@link BillingView} stays
 * prop-driven and unit-testable.
 */
export function BillingPanel({
  isOrgAdmin,
  organizationId,
  userId,
}: {
  isOrgAdmin: boolean;
  organizationId: string;
  userId: string | null;
}) {
  const billing = useOrganizationBilling(organizationId);
  const { refresh } = billing;
  const actions = useBillingActions({
    isOrgAdmin,
    organizationId,
    refresh,
    startTrial: billing.startTrial,
    userId,
  });
  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  return (
    <BillingView
      actionError={actions.actionError}
      activationPending={actions.activationPending}
      busy={actions.busy}
      canSubscribe={actions.canSubscribe}
      error={billing.error}
      isOrgAdmin={isOrgAdmin}
      loading={billing.loading}
      onRefresh={handleRefresh}
      onRestore={actions.restore}
      onStartTrial={actions.startTrial}
      onSubscribe={actions.subscribe}
      options={actions.options}
      purchaseAvailable={actions.purchaseAvailable}
      view={billing.view}
    />
  );
}
