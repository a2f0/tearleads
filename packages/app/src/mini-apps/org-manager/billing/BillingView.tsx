import type {
  OrganizationBillingView,
  SyncSubscriptionOption,
} from "@tearleads/client-sdk";
import {
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowButton,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/shared/MiniAppRow";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import {
  getOrgManagerBillingStatusLabel,
  getOrgManagerPeriodEndsLabel,
  getOrgManagerSeatsLabel,
  getOrgManagerTrialDaysLabel,
  getOrgManagerTrialEndsLabel,
  ORG_MANAGER_LABELS,
} from "../labels";

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
  readonly options: ReadonlyArray<SyncSubscriptionOption>;
  readonly busy: BillingBusyAction | null;
  readonly activationPending: boolean;
  readonly actionError: string | null;
  readonly onStartTrial: () => void;
  readonly onSubscribe: (option: SyncSubscriptionOption) => void;
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
  // Seats and the current-period end date only apply to a paid/trial subscription
  // (both are meaningless while local). seatCount is a derived active-member count.
  const seatsLabel =
    (view.isActive || view.isTrialing) && view.seatCount > 0
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

function BillingAdminActions({
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
