import type { SyncSubscriptionOption } from "@tearleads/client-sdk";
import {
  getLargestSyncBillingTier,
  getSyncBillingTierForSeatCount,
} from "@tearleads/validators/billing";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import { ORG_MANAGER_LABELS } from "../labels";

interface BillingPlanSwitcherProps {
  readonly busy: string | null;
  readonly canSubscribe: boolean;
  readonly currentSeatCount: number | null;
  readonly minimumSeatCount: number | null;
  readonly onSubscribe: (option: SyncSubscriptionOption) => void;
  readonly options: ReadonlyArray<SyncSubscriptionOption>;
  readonly pendingSeatCount: number | null;
}

type PlanAction = {
  readonly disabled: boolean;
  readonly label: string;
};

export function BillingPurchaseOption({
  actionLabel,
  disabled,
  name,
  onSelect,
  priceLabel,
}: {
  readonly actionLabel: string;
  readonly disabled: boolean;
  readonly name: string;
  readonly onSelect: () => void;
  readonly priceLabel: string;
}) {
  return (
    <MiniAppRow density="roomy" variant="framed">
      <MiniAppRowStack>
        <strong>{name}</strong>
        <MiniAppRowText muted>{priceLabel}</MiniAppRowText>
      </MiniAppRowStack>
      <MiniAppButton disabled={disabled} onClick={onSelect}>
        {actionLabel}
      </MiniAppButton>
    </MiniAppRow>
  );
}

function resolvePlanAction(input: {
  readonly busy: string | null;
  readonly currentSeatCount: number | null;
  readonly option: SyncSubscriptionOption;
  readonly pendingSeatCount: number | null;
}): PlanAction {
  const { busy, currentSeatCount, option, pendingSeatCount } = input;
  const currentTierId = getSyncBillingTierForSeatCount(
    currentSeatCount ?? 0,
  )?.id;
  const pendingTierId = getSyncBillingTierForSeatCount(
    pendingSeatCount ?? 0,
  )?.id;
  if (busy === `subscribe:${option.packageId}`) {
    return {
      disabled: true,
      label:
        currentSeatCount === null
          ? ORG_MANAGER_LABELS.billingSubscribing
          : ORG_MANAGER_LABELS.billingChangingPlan,
    };
  }
  if (option.tierId === pendingTierId) {
    return {
      disabled: true,
      label:
        currentSeatCount !== null &&
        pendingSeatCount !== null &&
        pendingSeatCount < currentSeatCount
          ? ORG_MANAGER_LABELS.billingPlanScheduled
          : ORG_MANAGER_LABELS.billingPlanUpdating,
    };
  }
  if (option.tierId === currentTierId) {
    return { disabled: true, label: ORG_MANAGER_LABELS.billingCurrentPlan };
  }
  if (currentSeatCount === null) {
    return { disabled: false, label: ORG_MANAGER_LABELS.billingSubscribe };
  }
  return {
    disabled: false,
    label:
      option.seatLimit > currentSeatCount
        ? ORG_MANAGER_LABELS.billingUpgradePlan
        : ORG_MANAGER_LABELS.billingDowngradePlan,
  };
}

export function BillingPlanSwitcher({
  busy,
  canSubscribe,
  currentSeatCount,
  minimumSeatCount,
  onSubscribe,
  options,
  pendingSeatCount,
}: BillingPlanSwitcherProps) {
  if (minimumSeatCount === null) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.loadingBilling}
      </MiniAppStatus>
    );
  }
  const eligibleOptions = options.filter(
    (option) => option.seatLimit >= minimumSeatCount,
  );
  if (eligibleOptions.length === 0) {
    const message =
      minimumSeatCount > getLargestSyncBillingTier().seatLimit
        ? ORG_MANAGER_LABELS.billingCheckoutOverCapacity
        : ORG_MANAGER_LABELS.billingNoOptions;
    return (
      <MiniAppStatus className="org-manager-hint">{message}</MiniAppStatus>
    );
  }
  return (
    <>
      {currentSeatCount === null ? null : (
        <MiniAppStatus className="org-manager-hint">
          {ORG_MANAGER_LABELS.billingPlanChangeTiming}
        </MiniAppStatus>
      )}
      {eligibleOptions.map((option) => {
        const action = resolvePlanAction({
          busy,
          currentSeatCount,
          option,
          pendingSeatCount,
        });
        return (
          <BillingPurchaseOption
            actionLabel={action.label}
            disabled={
              busy !== null ||
              pendingSeatCount !== null ||
              !canSubscribe ||
              action.disabled
            }
            key={option.packageId}
            name={option.title || ORG_MANAGER_LABELS.billingSubscribe}
            onSelect={() => onSubscribe(option)}
            priceLabel={option.priceLabel}
          />
        );
      })}
    </>
  );
}
