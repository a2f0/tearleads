import type {
  OrganizationBillingView,
  SyncSubscriptionOption,
} from "@symcrypt/client-sdk";
import { type Ref, useCallback } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import {
  getOrgManagerBillingStatusLabel,
  getOrgManagerPeriodEndsLabel,
  getOrgManagerSeatsInUseLabel,
  getOrgManagerSeatsLabel,
  getOrgManagerTrialDaysLabel,
  getOrgManagerTrialEndsLabel,
  ORG_MANAGER_LABELS,
} from "../labels";
import "./BillingCheckout.css";
import { BillingPlanSwitcher } from "./BillingPlanSwitcher";

/** Which action is currently in flight (`subscribe:<packageId>` while purchasing). */
export type BillingBusyAction = "trial" | "restore" | "refresh" | string;

export function BillingRecoveryStatus({
  error,
  message,
  onRetry,
}: {
  readonly error: string | null;
  readonly message: string | null;
  readonly onRetry: () => void;
}) {
  return (
    <>
      {message ? (
        <MiniAppStatus className="org-manager-hint">{message}</MiniAppStatus>
      ) : null}
      {error ? (
        <>
          <MiniAppStatus tone="error">{error}</MiniAppStatus>
          <MiniAppActions>
            <MiniAppButton onClick={onRetry} type="button">
              {ORG_MANAGER_LABELS.purgeRecoveryRetry}
            </MiniAppButton>
          </MiniAppActions>
        </>
      ) : null}
    </>
  );
}

export interface BillingViewProps {
  readonly view: OrganizationBillingView | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly isOrgAdmin: boolean;
  /**
   * Whether to offer the provider-hosted (RevenueCat) subscribe list. The
   * container turns this OFF where the direct card checkout is the purchase
   * path, so the two flows never both render.
   */
  readonly purchaseAvailable: boolean;
  /**
   * Whether the direct card checkout is the purchase path here (web + a Stripe
   * key). When true, this view renders NEITHER the subscribe list NOR the
   * "purchases unavailable" notice — the checkout, mounted by the container
   * below this view, is the purchase UI. Without this, turning
   * `purchaseAvailable` off to hide the RC list would wrongly surface the
   * unavailable notice even though a purchase path exists.
   */
  readonly directCheckoutAvailable?: boolean;
  /** Native checkout is present, but custom organizations must subscribe on web. */
  readonly nativePurchaseRestricted?: boolean;
  /** Existing subscription is owned elsewhere, so no purchase prompt belongs here. */
  readonly purchaseSectionHidden?: boolean;
  /** Whether this shell can restore provider purchases independently of buying. */
  readonly restoreAvailable: boolean;
  /** Whether the admin can actually purchase (platform supports it and the buyer is known). */
  readonly canSubscribe: boolean;
  /**
   * Whether this platform embeds a cancellable checkout in the panel (Web
   * Billing). Gates the in-app Cancel row so it never shows over a native
   * store sheet, which has its own dismissal.
   */
  readonly embeddedCheckout?: boolean;
  /**
   * True while an embedded checkout can still be cancelled — from purchase
   * start until it settles. Deliberately narrower than a `subscribe:*` busy
   * state, which also spans the post-payment billing refresh, when a Cancel
   * row would be a misleading no-op.
   */
  readonly checkoutActive?: boolean;
  /**
   * Host element the provider checkout renders into during a purchase (Web
   * Billing). The div is always mounted (hidden while empty) so it exists by
   * the time the purchase starts; without the ref the provider falls back to a
   * full-page overlay.
   */
  readonly checkoutHostRef?: Ref<HTMLDivElement>;
  readonly options: ReadonlyArray<SyncSubscriptionOption>;
  /** Minimum capacity the current effective roster requires; null while unknown. */
  readonly minimumSeatCount: number | null;
  /** Provider manage/cancel page for the active subscription, or null if none. */
  readonly managementUrl: string | null;
  /** Platform override for opening the provider's subscription management. */
  readonly onManageSubscription: (url: string) => void;
  readonly busy: BillingBusyAction | null;
  readonly activationPending: boolean;
  readonly actionError: string | null;
  /** Whether actionError came from loading the native purchase options. */
  readonly actionErrorIsOptionsError: boolean;
  readonly optionsRetryAvailable: boolean;
  readonly onStartTrial: () => void;
  readonly onSubscribe: (option: SyncSubscriptionOption) => void;
  /**
   * Dismiss the in-flight embedded checkout. The embedded provider UI hides
   * its own close control, so the panel renders the exit path — a Cancel row
   * shown for the whole embedded purchase (including the pre-mount phase,
   * where a hung provider request would otherwise leave no way out).
   */
  readonly onCancelCheckout?: () => void;
  readonly onRestore: () => void;
  readonly onRetryOptions: () => void;
  readonly onRefresh: () => void;
}

/**
 * Forwards the checkout host element to the parent's ref AND dismisses the
 * in-flight purchase the moment the host leaves the DOM. Driving cancellation
 * off the element's own lifecycle covers every unmount path at once — admin
 * role revoked, billing view lost, panel closed — without enumerating them.
 */
function useCheckoutHostRef(
  checkoutHostRef: Ref<HTMLDivElement> | undefined,
  onCancelCheckout: (() => void) | undefined,
) {
  return useCallback(
    (element: HTMLDivElement | null) => {
      if (typeof checkoutHostRef === "function") {
        checkoutHostRef(element);
      } else if (checkoutHostRef) {
        checkoutHostRef.current = element;
      }
      if (element === null) {
        onCancelCheckout?.();
      }
    },
    [checkoutHostRef, onCancelCheckout],
  );
}

function resolveBillingPeriodLabel(
  view: OrganizationBillingView,
): string | null {
  if (view.isActive && view.currentPeriodEndsAtMs !== null) {
    return getOrgManagerPeriodEndsLabel(
      formatMiniAppDate(view.currentPeriodEndsAtMs),
    );
  }
  if (view.isTrialing && view.trialEndsAtMs !== null) {
    return getOrgManagerTrialEndsLabel(formatMiniAppDate(view.trialEndsAtMs));
  }
  return null;
}

function resolveBillingSyncLabel(view: OrganizationBillingView): string {
  if (view.canSync) return ORG_MANAGER_LABELS.billingSyncOn;
  if (view.syncSeatUnavailable) {
    return ORG_MANAGER_LABELS.billingSyncSeatUnavailable;
  }
  return ORG_MANAGER_LABELS.billingSyncOff;
}

function BillingSeatSummary({ view }: { view: OrganizationBillingView }) {
  // `seatCount` is licensed capacity, not the number of members currently
  // occupying those seats. The free trial grants the largest fixed tier.
  const showsSeats = (view.isActive || view.isTrialing) && view.seatCount > 0;
  const periodLabel = resolveBillingPeriodLabel(view);
  if (!showsSeats && !periodLabel) return null;

  return (
    <MiniAppRow density="roomy">
      <MiniAppRowStack>
        {showsSeats ? (
          <>
            <MiniAppRowText>
              {getOrgManagerSeatsInUseLabel(
                view.assignedSeatCount,
                view.seatCount,
              )}
            </MiniAppRowText>
            <MiniAppRowText muted>
              {getOrgManagerSeatsLabel(view.seatCount)}
            </MiniAppRowText>
          </>
        ) : null}
        {periodLabel ? (
          <MiniAppRowText muted>{periodLabel}</MiniAppRowText>
        ) : null}
      </MiniAppRowStack>
    </MiniAppRow>
  );
}

function BillingSummary({ view }: { view: OrganizationBillingView }) {
  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        {ORG_MANAGER_LABELS.billingTitle}
      </MiniAppSectionHeading>
      <MiniAppRow density="roomy">
        <MiniAppRowStack>
          <strong>{getOrgManagerBillingStatusLabel(view.status)}</strong>
          <MiniAppRowText muted>{resolveBillingSyncLabel(view)}</MiniAppRowText>
        </MiniAppRowStack>
        {view.isTrialing && view.trialDaysRemaining !== null ? (
          <strong>
            {getOrgManagerTrialDaysLabel(view.trialDaysRemaining)}
          </strong>
        ) : null}
      </MiniAppRow>
      <BillingSeatSummary view={view} />
    </MiniAppSection>
  );
}

function BillingManageButton({
  onManageSubscription,
  url,
}: {
  readonly onManageSubscription: (url: string) => void;
  readonly url: string;
}) {
  return (
    <MiniAppButton onClick={() => onManageSubscription(url)}>
      {ORG_MANAGER_LABELS.billingManageSubscription}
    </MiniAppButton>
  );
}

function visibleBillingActionError(
  props: Pick<
    BillingViewProps,
    | "actionError"
    | "actionErrorIsOptionsError"
    | "optionsRetryAvailable"
    | "purchaseAvailable"
    | "purchaseSectionHidden"
  >,
): string | null {
  if (!props.actionError) return null;
  if (!props.actionErrorIsOptionsError) return props.actionError;
  return props.purchaseAvailable && !props.purchaseSectionHidden
    ? props.actionError
    : null;
}

/**
 * The purchase slot: the provider-hosted subscribe list, or nothing when the
 * direct card checkout is the path (it mounts below this view), or the
 * "unavailable" notice only when NEITHER path exists.
 */
function BillingPurchaseSection({
  checkoutHostRef,
  currentSeatCount,
  pendingSeatCount,
  ...props
}: Omit<BillingViewProps, "view" | "loading" | "managementUrl"> & {
  readonly checkoutHostRef: Ref<HTMLDivElement>;
  readonly currentSeatCount: number | null;
  readonly pendingSeatCount: number | null;
}) {
  if (props.purchaseSectionHidden) {
    return null;
  }
  if (!props.purchaseAvailable) {
    // Direct checkout is the path → render nothing (it mounts below); only a
    // total absence of any purchase path shows the notice.
    return props.directCheckoutAvailable ? null : (
      <MiniAppStatus className="org-manager-hint">
        {props.nativePurchaseRestricted
          ? ORG_MANAGER_LABELS.billingCustomOrganizationWebOnly
          : ORG_MANAGER_LABELS.billingPurchaseUnavailable}
      </MiniAppStatus>
    );
  }
  return (
    <>
      <BillingPlanSwitcher
        busy={props.busy}
        canSubscribe={props.canSubscribe && !props.activationPending}
        currentSeatCount={currentSeatCount}
        minimumSeatCount={props.minimumSeatCount}
        onSubscribe={props.onSubscribe}
        options={props.options}
        pendingSeatCount={pendingSeatCount}
      />
      {/* The host (and its cancel-on-detach lifecycle) exists only where the
          backend actually embeds into it. On native platforms the purchase
          runs in a store sheet the app cannot cancel, so a detaching host must
          not settle the flow as cancelled. */}
      {props.embeddedCheckout ? (
        <div className="org-manager-billing-checkout" ref={checkoutHostRef} />
      ) : null}
      {props.embeddedCheckout && props.checkoutActive ? (
        <MiniAppActions>
          <MiniAppButton onClick={props.onCancelCheckout}>
            {ORG_MANAGER_LABELS.billingCancelCheckout}
          </MiniAppButton>
        </MiniAppActions>
      ) : null}
    </>
  );
}

function BillingAdminActions({
  managementUrl,
  view,
  ...props
}: Omit<BillingViewProps, "view" | "loading"> & {
  readonly view: OrganizationBillingView;
}) {
  const checkoutHostRef = useCheckoutHostRef(
    props.checkoutHostRef,
    props.onCancelCheckout,
  );
  const actionError = visibleBillingActionError(props);
  return (
    <MiniAppSection>
      {view.status === "local" ? (
        <MiniAppActions>
          <MiniAppButton
            disabled={props.busy !== null}
            onClick={props.onStartTrial}
          >
            {props.busy === "trial"
              ? ORG_MANAGER_LABELS.billingStartingTrial
              : ORG_MANAGER_LABELS.billingStartTrial}
          </MiniAppButton>
        </MiniAppActions>
      ) : null}

      <BillingPurchaseSection
        {...props}
        checkoutHostRef={checkoutHostRef}
        currentSeatCount={view.isActive ? view.seatCount : null}
        pendingSeatCount={view.pendingSeatCount}
      />

      <MiniAppActions>
        {props.optionsRetryAvailable &&
        props.purchaseAvailable &&
        !props.purchaseSectionHidden ? (
          <MiniAppButton
            disabled={props.busy !== null}
            onClick={props.onRetryOptions}
          >
            {ORG_MANAGER_LABELS.billingRetryOptions}
          </MiniAppButton>
        ) : null}
        {props.restoreAvailable ? (
          <MiniAppButton
            disabled={props.busy !== null}
            onClick={props.onRestore}
          >
            {props.busy === "restore"
              ? ORG_MANAGER_LABELS.billingRestoring
              : ORG_MANAGER_LABELS.billingRestore}
          </MiniAppButton>
        ) : null}
        {managementUrl ? (
          <BillingManageButton
            onManageSubscription={props.onManageSubscription}
            url={managementUrl}
          />
        ) : null}
        <MiniAppButton disabled={props.busy !== null} onClick={props.onRefresh}>
          {ORG_MANAGER_LABELS.refresh}
        </MiniAppButton>
      </MiniAppActions>

      {props.activationPending ? (
        <MiniAppStatus className="org-manager-hint">
          {ORG_MANAGER_LABELS.billingActivationPending}
        </MiniAppStatus>
      ) : null}
      {actionError ? (
        <MiniAppStatus tone="error">{actionError}</MiniAppStatus>
      ) : null}
      {props.error ? (
        <MiniAppStatus tone="error">{props.error}</MiniAppStatus>
      ) : null}
    </MiniAppSection>
  );
}

export function BillingView({ loading, view, ...rest }: BillingViewProps) {
  if (!view) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {loading
          ? ORG_MANAGER_LABELS.loadingBilling
          : ORG_MANAGER_LABELS.billingUnavailable}
      </MiniAppStatus>
    );
  }

  return (
    <div>
      <BillingSummary view={view} />
      {rest.isOrgAdmin ? (
        <BillingAdminActions {...rest} view={view} />
      ) : (
        <MiniAppSection>
          <MiniAppStatus className="org-manager-hint">
            {ORG_MANAGER_LABELS.billingAdminOnly}
          </MiniAppStatus>
        </MiniAppSection>
      )}
    </div>
  );
}
