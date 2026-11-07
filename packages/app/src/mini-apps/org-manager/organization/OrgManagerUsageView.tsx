import type {
  OrganizationDataUsage,
  OrganizationDeviceDataUsage,
} from "@tearleads/client-sdk";
import { useWindowRefreshMenuItem } from "@tearleads/windowing";
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
  getBlobCountLabel,
  getDocumentCountLabel,
  UsageBreakdown,
  UsageMetric,
} from "../../shared/DataUsageRows";
import { DataUsageView } from "../../shared/DataUsageView";
import { DATA_USAGE_LABELS } from "../../shared/dataUsageLabels";
import type { DeviceDataUsageState } from "./deviceDataUsageState";
import { useDeviceDataUsage } from "./useDeviceDataUsage";

type UsageTabId = "synced" | "device";

const USAGE_TABS: ReadonlyArray<MiniAppTabDescriptor<UsageTabId>> = [
  { id: "synced", label: DATA_USAGE_LABELS.usageSyncedTab },
  { id: "device", label: DATA_USAGE_LABELS.usageDeviceTab },
];

function DeviceDataUsageMetrics({
  usage,
}: {
  usage: OrganizationDeviceDataUsage;
}) {
  const documentBreakdown = usage.documents.breakdown
    .filter((entry) => entry.documentCount > 0)
    .map((entry) => ({
      byteLength: entry.byteLength,
      category: entry.category,
      detail: getDocumentCountLabel(entry.documentCount),
    }));

  return (
    <>
      <UsageMetric
        byteLength={usage.documents.byteLength}
        detail={getDocumentCountLabel(usage.documents.documentCount)}
        label={DATA_USAGE_LABELS.usageDocuments}
      />
      <UsageBreakdown entries={documentBreakdown} />
      <UsageMetric
        byteLength={usage.blobs.byteLength}
        detail={getBlobCountLabel(usage.blobs.blobCount)}
        label={DATA_USAGE_LABELS.usageBlobs}
      />
      <UsageMetric
        byteLength={usage.totalByteLength}
        detail={DATA_USAGE_LABELS.usageData}
        label={DATA_USAGE_LABELS.usageTotal}
      />
    </>
  );
}

function DeviceDataUsageContent({ state }: { state: DeviceDataUsageState }) {
  switch (state.status) {
    case "loading":
      return (
        <MiniAppStatus busy>
          {DATA_USAGE_LABELS.loadingDeviceDataUsage}
        </MiniAppStatus>
      );
    case "unavailable":
      return (
        <MiniAppStatus>
          {DATA_USAGE_LABELS.deviceUsageUnavailable}
        </MiniAppStatus>
      );
    case "failed":
      return (
        <MiniAppStatus tone="error">
          {DATA_USAGE_LABELS.deviceUsageFailed}
        </MiniAppStatus>
      );
    case "ready":
    case "refreshing":
      return <DeviceDataUsageMetrics usage={state.usage} />;
  }
}

/**
 * What this device stores for the organization. Measures on mount (the On
 * device tab being shown) and takes over the window Refresh while open, above
 * the roster-wide refresh, so Refresh re-measures instead of re-syncing.
 */
function DeviceDataUsagePanel({ organizationId }: { organizationId: string }) {
  const { remeasure, state } = useDeviceDataUsage(organizationId);
  const measuring = state.status === "loading" || state.status === "refreshing";
  useWindowRefreshMenuItem({
    disabled: measuring,
    onRefresh: remeasure,
    priority: 100,
    refreshing: measuring,
  });

  return (
    <div>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {DATA_USAGE_LABELS.deviceDataUsage}
        </MiniAppSectionHeading>
        <MiniAppStatus>{DATA_USAGE_LABELS.deviceUsageDefinition}</MiniAppStatus>
        <DeviceDataUsageContent state={state} />
      </MiniAppSection>
    </div>
  );
}

/** Org Manager's Usage view: synced (server) usage and on-device usage. */
export function OrgManagerUsageView({
  canSync,
  dataUsage,
  organizationId,
  pending,
}: {
  canSync: boolean | null;
  dataUsage: OrganizationDataUsage | null;
  organizationId: string;
  pending: boolean;
}) {
  const idPrefix = useId();
  const [activeTab, setActiveTab] = useState<UsageTabId>("synced");

  return (
    <div>
      <MiniAppTabList
        activeTab={activeTab}
        idPrefix={idPrefix}
        label={DATA_USAGE_LABELS.usageTabsLabel}
        onSelect={setActiveTab}
        tabs={USAGE_TABS}
      />
      <MiniAppTabPanel activeTab={activeTab} idPrefix={idPrefix}>
        {activeTab === "synced" ? (
          <DataUsageView
            canSync={canSync}
            dataUsage={dataUsage}
            pending={pending}
          />
        ) : (
          <DeviceDataUsagePanel organizationId={organizationId} />
        )}
      </MiniAppTabPanel>
    </div>
  );
}
