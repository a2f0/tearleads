import type { OrganizationBillingHistoryEntry } from "@tearleads/client-sdk";
import { useId, useState } from "react";
import {
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  type MiniAppTabDescriptor,
  MiniAppTabList,
  MiniAppTabPanel,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import { getOrgManagerBillingEventLabel, ORG_MANAGER_LABELS } from "../labels";
import { BillingHistoryEntryDetails } from "./BillingHistoryEntryDetails";
import type { useBillingHistory } from "./useBillingHistory";

type BillingHistoryTabId = "activity" | "events";

const BILLING_HISTORY_TABS: ReadonlyArray<
  MiniAppTabDescriptor<BillingHistoryTabId>
> = [
  { id: "activity", label: ORG_MANAGER_LABELS.billingHistoryActivityTab },
  { id: "events", label: ORG_MANAGER_LABELS.billingHistoryEventsTab },
];

interface BillingHistoryProps {
  readonly entries: ReadonlyArray<OrganizationBillingHistoryEntry> | null;
  readonly loading: boolean;
  readonly error: string | null;
}

export function OptionalBillingHistory({
  enabled,
  history,
}: {
  readonly enabled: boolean;
  readonly history: ReturnType<typeof useBillingHistory>;
}) {
  return enabled ? <BillingHistory {...history} /> : null;
}

// Activity: only events that changed billing, phrased as friendly labels.
function BillingActivityList({
  entries,
}: {
  entries: ReadonlyArray<OrganizationBillingHistoryEntry>;
}) {
  const applied = entries.filter((entry) => entry.outcome === "applied");
  if (applied.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.billingHistoryEmpty}
      </MiniAppStatus>
    );
  }
  return (
    <>
      {applied.map((entry) => (
        <MiniAppRow density="roomy" key={entry.id}>
          <MiniAppRowStack>
            <strong>{getOrgManagerBillingEventLabel(entry.eventType)}</strong>
            <BillingHistoryEntryDetails entry={entry} />
            <MiniAppRowText muted>
              {formatMiniAppDateTime(entry.occurredAt)}
            </MiniAppRowText>
          </MiniAppRowStack>
        </MiniAppRow>
      ))}
    </>
  );
}

// Events: every normalized audit record with its raw type and outcome — a
// diagnostic view of the durable sources behind the friendly activity list.
function BillingEventList({
  entries,
}: {
  entries: ReadonlyArray<OrganizationBillingHistoryEntry>;
}) {
  if (entries.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.billingHistoryEmpty}
      </MiniAppStatus>
    );
  }
  return (
    <>
      {entries.map((entry) => (
        <MiniAppRow density="roomy" key={entry.id}>
          <MiniAppRowStack>
            <strong>{entry.eventType}</strong>
            <BillingHistoryEntryDetails entry={entry} includeAuditFields />
            <MiniAppRowText muted>
              {formatMiniAppDateTime(entry.occurredAt)}
            </MiniAppRowText>
          </MiniAppRowStack>
        </MiniAppRow>
      ))}
    </>
  );
}

/**
 * The organization's lifecycle, licensed-seat, and paid-invoice history in a
 * two-tab split: a friendly Activity feed of applied events and a raw Events
 * audit view. Prop-driven; {@link BillingPanel} loads the entries through the
 * SDK for org admins.
 */
export function BillingHistory({
  entries,
  error,
  loading,
}: BillingHistoryProps) {
  const idPrefix = useId();
  const [activeTab, setActiveTab] = useState<BillingHistoryTabId>("activity");

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        {ORG_MANAGER_LABELS.billingHistoryTitle}
      </MiniAppSectionHeading>
      <MiniAppTabList
        activeTab={activeTab}
        idPrefix={idPrefix}
        label={ORG_MANAGER_LABELS.billingHistoryTabsLabel}
        onSelect={setActiveTab}
        tabs={BILLING_HISTORY_TABS}
      />
      <MiniAppTabPanel activeTab={activeTab} idPrefix={idPrefix}>
        {error ? <MiniAppStatus tone="error">{error}</MiniAppStatus> : null}
        {!error && loading ? (
          <MiniAppStatus className="org-manager-hint">
            {ORG_MANAGER_LABELS.loadingBillingHistory}
          </MiniAppStatus>
        ) : null}
        {!error && !loading ? (
          activeTab === "activity" ? (
            <BillingActivityList entries={entries ?? []} />
          ) : (
            <BillingEventList entries={entries ?? []} />
          )
        ) : null}
      </MiniAppTabPanel>
    </MiniAppSection>
  );
}
