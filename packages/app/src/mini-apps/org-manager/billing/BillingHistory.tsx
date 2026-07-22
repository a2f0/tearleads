import type { OrganizationBillingHistoryEntry } from "@tearleads/client-sdk";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useId,
  useState,
} from "react";
import {
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
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import { getOrgManagerBillingEventLabel, ORG_MANAGER_LABELS } from "../labels";
import { BillingHistoryEntryDetails } from "./BillingHistoryEntryDetails";
import "./BillingHistory.css";

type BillingHistoryTabId = "activity" | "events";

const BILLING_HISTORY_TABS: ReadonlyArray<{
  id: BillingHistoryTabId;
  label: string;
}> = [
  { id: "activity", label: ORG_MANAGER_LABELS.billingHistoryActivityTab },
  { id: "events", label: ORG_MANAGER_LABELS.billingHistoryEventsTab },
];

interface BillingHistoryProps {
  readonly entries: ReadonlyArray<OrganizationBillingHistoryEntry> | null;
  readonly loading: boolean;
  readonly error: string | null;
}

// Roving tabindex per the WAI-ARIA tab pattern (mirrors BackupRestoreTabBar):
// only the active tab is in the tab order; arrow/Home/End move focus and
// selection.
function BillingHistoryTabBar({
  activeTab,
  idPrefix,
  onSelect,
}: {
  activeTab: BillingHistoryTabId;
  idPrefix: string;
  onSelect: (tab: BillingHistoryTabId) => void;
}) {
  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const lastIndex = BILLING_HISTORY_TABS.length - 1;
      const currentIndex = BILLING_HISTORY_TABS.findIndex(
        (tab) => tab.id === activeTab,
      );
      let nextIndex: number;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = lastIndex;
          break;
        default:
          return;
      }
      const nextTab = BILLING_HISTORY_TABS[nextIndex];
      if (!nextTab) {
        return;
      }
      event.preventDefault();
      onSelect(nextTab.id);
      document.getElementById(`${idPrefix}-${nextTab.id}-tab`)?.focus();
    },
    [activeTab, idPrefix, onSelect],
  );

  return (
    <div
      aria-label={ORG_MANAGER_LABELS.billingHistoryTabsLabel}
      className="billing-history-tabs"
      role="tablist"
    >
      {BILLING_HISTORY_TABS.map((tab) => (
        <MiniAppButton
          aria-controls={`${idPrefix}-${tab.id}-panel`}
          aria-selected={activeTab === tab.id}
          className="billing-history-tab"
          id={`${idPrefix}-${tab.id}-tab`}
          key={tab.id}
          role="tab"
          tabIndex={activeTab === tab.id ? 0 : -1}
          variant="ghost"
          onClick={() => {
            onSelect(tab.id);
          }}
          onKeyDown={handleTabKeyDown}
        >
          {tab.label}
        </MiniAppButton>
      ))}
    </div>
  );
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
      <BillingHistoryTabBar
        activeTab={activeTab}
        idPrefix={idPrefix}
        onSelect={setActiveTab}
      />
      <div
        aria-labelledby={`${idPrefix}-${activeTab}-tab`}
        className="billing-history-tab-panel"
        id={`${idPrefix}-${activeTab}-panel`}
        role="tabpanel"
      >
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
      </div>
    </MiniAppSection>
  );
}
