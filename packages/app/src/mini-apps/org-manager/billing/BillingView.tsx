import type {
  OrganizationBillingView,
  SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import type { Ref } from "react";
import {
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowButton,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import {
  getOrgManagerBillingStatusLabel,
  getOrgManagerPeriodEndsLabel,
  getOrgManagerSeatsLabel,
  getOrgManagerTrialDaysLabel,
  getOrgManagerTrialEndsLabel,
  ORG_MANAGER_LABELS,
} from "../labels";
import "./BillingCheckout.css";

/** Which action is currently in flight (`subscribe:<packageId>` while purchasing). */
export type BillingBusyAction = "trial" | "restore" | "refresh" | string;

export interface BillingViewProps {
  readonly view: OrganizationBillingView | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly isOrgAdmin: boolean;
  /** Whether in-app purchases can run on this platform (false → web/desktop stub). */
  readonly purchaseAvailable: boolean;
  /** Whether the admin can actually purchase (platform supports it and the buyer is known). */
  readonly canSubscribe: boolean;
  /**
   * Host element the provider checkout renders into during a purchase (Web
   * Billing). The div is always mounted (hidden while empty) so it exists by
   * the time the purchase starts; without the ref the provider falls back to a
   * full-page overlay.
   */
  readonly checkoutHostRef?: Ref<HTMLDivElement>;
  readonly options: ReadonlyArray<SyncSubscriptionOption>;
  /** Provider manage/cancel page for the active subscription, or null if none. */
  readonly managementUrl: string | null;
  readonly busy: BillingBusyAction | null;
  readonly activationPending: boolean;
  readonly actionError: string | null;
  readonly onStartTrial: () => void;
  readonly onSubscribe: (option: SyncSubscriptionOption) => void;
  /**
   * Dismiss the in-flight embedded checkout. The embedded provider UI hides
   * its own close control, so the panel renders the exit path — a Cancel
   * button that CSS shows only while the checkout host has content.
   */
  readonly onCancelCheckout?: () => void;
  readonly onRestore: () => void;
  readonly onRefresh: () => void;
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

function BillingSummary({ view }: { view: OrganizationBillingView }) {
  // Only an active paid subscription has *billed* seats (seatCount is the derived
  // active-member count for the paid period); a free trial is not billed, and a
  // local org has neither seats nor a period date.
  const seatsLabel =
    view.isActive && view.seatCount > 0
      ? getOrgManagerSeatsLabel(view.seatCount)
      : null;
  const periodLabel = resolveBillingPeriodLabel(view);

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        {ORG_MANAGER_LABELS.billingTitle}
      </MiniAppSectionHeading>
      <MiniAppRow density="roomy">
        <MiniAppRowStack>
          <strong>{getOrgManagerBillingStatusLabel(view.status)}</strong>
          <MiniAppRowText muted>
            {view.canSync
              ? ORG_MANAGER_LABELS.billingSyncOn
              : ORG_MANAGER_LABELS.billingSyncOff}
          </MiniAppRowText>
        </MiniAppRowStack>
        {view.isTrialing && view.trialDaysRemaining !== null ? (
          <strong>
            {getOrgManagerTrialDaysLabel(view.trialDaysRemaining)}
          </strong>
        ) : null}
      </MiniAppRow>
      {seatsLabel || periodLabel ? (
        <MiniAppRow density="roomy">
          <MiniAppRowStack>
            {seatsLabel ? <MiniAppRowText>{seatsLabel}</MiniAppRowText> : null}
            {periodLabel ? (
              <MiniAppRowText muted>{periodLabel}</MiniAppRowText>
            ) : null}
          </MiniAppRowStack>
        </MiniAppRow>
      ) : null}
    </MiniAppSection>
  );
}

function BillingSubscribeList({
  busy,
  canSubscribe,
  onSubscribe,
  options,
}: Pick<
  BillingViewProps,
  "busy" | "canSubscribe" | "onSubscribe" | "options"
>) {
  if (options.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.billingNoOptions}
      </MiniAppStatus>
    );
  }
  return (
    <>
      {options.map((option) => (
        <MiniAppRowButton
          disabled={busy !== null || !canSubscribe}
          key={option.packageId}
          onClick={() => onSubscribe(option)}
        >
          <MiniAppRowStack>
            <strong>
              {option.title || ORG_MANAGER_LABELS.billingSubscribe}
            </strong>
            <MiniAppRowText muted>{option.priceLabel}</MiniAppRowText>
          </MiniAppRowStack>
          <MiniAppRowText>
            {busy === `subscribe:${option.packageId}`
              ? ORG_MANAGER_LABELS.billingSubscribing
              : ORG_MANAGER_LABELS.billingSubscribe}
          </MiniAppRowText>
        </MiniAppRowButton>
      ))}
    </>
  );
}

// Opens the provider's manage/cancel page in a new tab. The URL is pre-loaded
// into props, so window.open runs synchronously inside the click gesture (no
// popup-blocker issue); `_blank` routes to the system browser on Capacitor.
function BillingManageButton({ url }: { url: string }) {
  return (
    <MiniAppRowButton
      onClick={() => {
        window.open(url, "_blank", "noopener,noreferrer");
      }}
    >
      <MiniAppRowText>
        {ORG_MANAGER_LABELS.billingManageSubscription}
      </MiniAppRowText>
    </MiniAppRowButton>
  );
}

function BillingAdminActions({
  managementUrl,
  view,
  ...props
}: Omit<BillingViewProps, "view" | "loading"> & {
  readonly view: OrganizationBillingView;
}) {
  return (
    <MiniAppSection>
      {view.status === "local" ? (
        <MiniAppRowButton
          disabled={props.busy !== null}
          onClick={props.onStartTrial}
        >
          <MiniAppRowText>
            {props.busy === "trial"
              ? ORG_MANAGER_LABELS.billingStartingTrial
              : ORG_MANAGER_LABELS.billingStartTrial}
          </MiniAppRowText>
        </MiniAppRowButton>
      ) : null}

      {props.purchaseAvailable ? (
        <>
          <BillingSubscribeList
            busy={props.busy}
            canSubscribe={props.canSubscribe}
            onSubscribe={props.onSubscribe}
            options={props.options}
          />
          <div
            className="org-manager-billing-checkout"
            ref={props.checkoutHostRef}
          />
          <MiniAppRowButton
            className="org-manager-billing-checkout-cancel"
            onClick={props.onCancelCheckout}
          >
            <MiniAppRowText>
              {ORG_MANAGER_LABELS.billingCancelCheckout}
            </MiniAppRowText>
          </MiniAppRowButton>
          <MiniAppRowButton
            disabled={props.busy !== null}
            onClick={props.onRestore}
          >
            <MiniAppRowText>
              {props.busy === "restore"
                ? ORG_MANAGER_LABELS.billingRestoring
                : ORG_MANAGER_LABELS.billingRestore}
            </MiniAppRowText>
          </MiniAppRowButton>
        </>
      ) : (
        <MiniAppStatus className="org-manager-hint">
          {ORG_MANAGER_LABELS.billingPurchaseUnavailable}
        </MiniAppStatus>
      )}

      {managementUrl ? <BillingManageButton url={managementUrl} /> : null}

      <MiniAppRowButton
        disabled={props.busy !== null}
        onClick={props.onRefresh}
      >
        <MiniAppRowText>{ORG_MANAGER_LABELS.refresh}</MiniAppRowText>
      </MiniAppRowButton>

      {props.activationPending ? (
        <MiniAppStatus className="org-manager-hint">
          {ORG_MANAGER_LABELS.billingActivationPending}
        </MiniAppStatus>
      ) : null}
      {props.actionError ? (
        <MiniAppStatus tone="error">{props.actionError}</MiniAppStatus>
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
