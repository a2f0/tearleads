import type {
  OrganizationBillingView,
  SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import {
  getLargestSyncBillingTier,
  getSyncBillingTierForSeatCount,
} from "@tearleads/validators/billing";
import type { StripeSyncOptionResponse } from "@tearleads/validators/response";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import { formatPrice } from "../../shared/billingFormatters";
import { ORG_MANAGER_LABELS } from "../labels";
import {
  type StripePlanChangeState,
  type StripePlanDirection,
  stripePlanDirection,
} from "../model/stripePlanChangeMachine";
import {
  type StripePlanChangeFlow,
  useStripePlanChange,
} from "../model/useStripePlanChange";
import { PLAN_CHANGE_LABELS } from "./checkoutCopy";

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

function resolveExactTierId(seatCount: number | null): string | undefined {
  const tier = getSyncBillingTierForSeatCount(seatCount ?? 0);
  return tier?.seatLimit === seatCount ? tier.id : undefined;
}

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
  const currentTierId = resolveExactTierId(currentSeatCount);
  const pendingTierId = resolveExactTierId(pendingSeatCount);
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
  const pendingTierCannotCoverRoster =
    pendingSeatCount !== null && pendingSeatCount < minimumSeatCount;
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
          {pendingTierCannotCoverRoster
            ? ORG_MANAGER_LABELS.billingPlanScheduledCapacityConflict
            : ORG_MANAGER_LABELS.billingPlanChangeTiming}
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
            disabled={busy !== null || !canSubscribe || action.disabled}
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

function stripePriceLabel(option: StripeSyncOptionResponse): string {
  return formatPrice(
    option.unitAmount,
    option.currency,
    option.interval,
    option.intervalCount,
  );
}

interface StripePlanContext {
  readonly pendingSeatCount: number | null;
  readonly seatCount: number;
  readonly state: StripePlanChangeState;
}

/** A row's action: upgrade, schedule a downgrade, or keep the plan. */
function resolveStripePlanAction(
  option: StripeSyncOptionResponse,
  context: StripePlanContext,
): PlanAction & { readonly direction: StripePlanDirection } {
  const direction = stripePlanDirection(option, context.seatCount);
  const { state } = context;
  if (state.kind === "changing" && state.option.priceId === option.priceId) {
    return {
      direction,
      disabled: true,
      label: ORG_MANAGER_LABELS.billingChangingPlan,
    };
  }
  if (option.seatLimit === context.pendingSeatCount) {
    return {
      direction,
      disabled: true,
      label: ORG_MANAGER_LABELS.billingPlanScheduled,
    };
  }
  if (direction === "keep") {
    // Re-choosing the current plan cancels a scheduled smaller one.
    return context.pendingSeatCount === null
      ? {
          direction,
          disabled: true,
          label: ORG_MANAGER_LABELS.billingCurrentPlan,
        }
      : { direction, disabled: false, label: PLAN_CHANGE_LABELS.keepPlan };
  }
  return {
    direction,
    disabled: false,
    label:
      direction === "upgrade"
        ? ORG_MANAGER_LABELS.billingUpgradePlan
        : ORG_MANAGER_LABELS.billingDowngradePlan,
  };
}

function stripePlanNotice(
  state: Extract<StripePlanChangeState, { kind: "confirming" | "changing" }>,
  renewsAtMs: number | null,
): string {
  const name = state.option.productName;
  switch (state.direction) {
    case "upgrade":
      return PLAN_CHANGE_LABELS.upgradeNotice(name);
    case "downgrade":
      return PLAN_CHANGE_LABELS.downgradeNotice(
        name,
        renewsAtMs === null ? "" : formatMiniAppDate(renewsAtMs),
      );
    case "keep":
      return PLAN_CHANGE_LABELS.keepNotice(name);
  }
}

const CONFIRM_LABELS: Readonly<Record<StripePlanDirection, string>> = {
  downgrade: PLAN_CHANGE_LABELS.confirmDowngrade,
  keep: PLAN_CHANGE_LABELS.confirmKeep,
  upgrade: PLAN_CHANGE_LABELS.confirmUpgrade,
};

/** The confirmation an upgrade's charge, or a scheduled change, needs first. */
function StripePlanConfirmation({
  flow,
  renewsAtMs,
}: {
  readonly flow: StripePlanChangeFlow;
  readonly renewsAtMs: number | null;
}) {
  const { state } = flow;
  if (state.kind === "idle") {
    const { outcome } = state;
    if (!outcome) return null;
    return outcome.kind === "changed" ? (
      <MiniAppStatus className="org-manager-hint">
        {PLAN_CHANGE_LABELS.changed[outcome.change]}
      </MiniAppStatus>
    ) : (
      <MiniAppStatus className="org-manager-hint" tone="error">
        {outcome.error}
      </MiniAppStatus>
    );
  }
  const changing = state.kind === "changing";
  return (
    <>
      <MiniAppStatus className="org-manager-hint" busy={changing}>
        {stripePlanNotice(state, renewsAtMs)}
      </MiniAppStatus>
      <MiniAppActions>
        <MiniAppButton disabled={changing} onClick={flow.dismiss}>
          {PLAN_CHANGE_LABELS.cancel}
        </MiniAppButton>
        <MiniAppButton disabled={changing} onClick={flow.confirm}>
          {changing
            ? ORG_MANAGER_LABELS.billingChangingPlan
            : CONFIRM_LABELS[state.direction]}
        </MiniAppButton>
      </MiniAppActions>
    </>
  );
}

function StripePlanRows({
  context,
  disabled,
  flow,
  options,
}: {
  readonly context: StripePlanContext;
  readonly disabled: boolean;
  readonly flow: StripePlanChangeFlow;
  readonly options: readonly StripeSyncOptionResponse[];
}) {
  return options.map((option) => {
    const action = resolveStripePlanAction(option, context);
    return (
      <BillingPurchaseOption
        actionLabel={action.label}
        disabled={
          disabled || context.state.kind === "changing" || action.disabled
        }
        key={option.priceId}
        name={option.productName}
        onSelect={() => flow.choose(option)}
        priceLabel={stripePriceLabel(option)}
      />
    );
  });
}

interface StripePlanSwitcherProps {
  readonly disabled: boolean;
  readonly minimumSeatCount: number | null;
  readonly organizationId: string;
  readonly pendingSeatCount: number | null;
  readonly refresh: () => Promise<void>;
  readonly renewsAtMs: number | null;
  readonly seatCount: number;
}

/**
 * Changes an active Stripe subscription's plan, for an administrator where
 * web checkout runs; nothing for any other subscription. A web subscription
 * is never upgraded from inside a store app, which allows only the store's
 * own purchases there.
 */
export function BillingStripePlanSwitcher({
  billing,
  disabled,
  organizationId,
}: {
  readonly billing: {
    readonly billing: { readonly activeMemberCount: number } | null;
    readonly refresh: () => Promise<void>;
    readonly view: OrganizationBillingView | null;
  };
  readonly disabled: boolean;
  readonly organizationId: string;
}) {
  const { view } = billing;
  if (!view?.isActive || view.subscriptionSource !== "stripe") {
    return null;
  }
  return (
    <StripePlanSwitcher
      disabled={disabled}
      minimumSeatCount={billing.billing?.activeMemberCount ?? null}
      organizationId={organizationId}
      pendingSeatCount={view.pendingSeatCount}
      refresh={billing.refresh}
      renewsAtMs={view.currentPeriodEndsAtMs}
      seatCount={view.seatCount}
    />
  );
}

/**
 * Every plan that covers the roster (`model/useStripePlanChange.ts`), with an
 * upgrade charged now and a downgrade scheduled for renewal, each confirmed
 * first.
 */
function StripePlanSwitcher({
  disabled,
  minimumSeatCount,
  organizationId,
  pendingSeatCount,
  refresh,
  renewsAtMs,
  seatCount,
}: StripePlanSwitcherProps) {
  const flow = useStripePlanChange({ organizationId, refresh, seatCount });
  const { offer } = flow;
  if (offer.status === "off" || offer.status === "loading") {
    return (
      <MiniAppStatus className="org-manager-hint" busy>
        {ORG_MANAGER_LABELS.loadingBilling}
      </MiniAppStatus>
    );
  }
  if (offer.status === "failed") {
    return (
      <>
        <MiniAppStatus className="org-manager-hint" tone="error">
          {offer.error}
        </MiniAppStatus>
        <MiniAppActions>
          <MiniAppButton disabled={disabled} onClick={flow.retryOptions}>
            {ORG_MANAGER_LABELS.billingRetryOptions}
          </MiniAppButton>
        </MiniAppActions>
      </>
    );
  }
  const conflict =
    pendingSeatCount !== null &&
    minimumSeatCount !== null &&
    pendingSeatCount < minimumSeatCount;
  return (
    <>
      <MiniAppStatus className="org-manager-hint">
        {conflict
          ? PLAN_CHANGE_LABELS.scheduledCapacityConflict
          : PLAN_CHANGE_LABELS.timing}
      </MiniAppStatus>
      <StripePlanRows
        context={{ pendingSeatCount, seatCount, state: flow.state }}
        disabled={disabled}
        flow={flow}
        options={offer.options}
      />
      <StripePlanConfirmation flow={flow} renewsAtMs={renewsAtMs} />
    </>
  );
}
