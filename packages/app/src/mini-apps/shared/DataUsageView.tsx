import type { OrganizationDataUsage } from "@tearleads/client-sdk";
import {
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import {
  getBlobCountLabel,
  getDocumentCountLabel,
  getUsageCountLabel,
  UsageBreakdown,
  UsageMetric,
} from "./DataUsageRows";
import { DATA_USAGE_LABELS } from "./dataUsageLabels";

function getDocumentUsageDetail(
  documentCount: number,
  updateCount: number,
): string {
  return `${getDocumentCountLabel(documentCount)}, ${getUsageCountLabel(
    updateCount,
    DATA_USAGE_LABELS.usageUpdate,
    DATA_USAGE_LABELS.usageUpdatesUnit,
  )}`;
}

export function DataUsageView({
  canSync,
  dataUsage,
  pending,
}: {
  canSync: boolean | null;
  dataUsage: OrganizationDataUsage | null;
  pending: boolean;
}) {
  if (!dataUsage) {
    return (
      <MiniAppStatus>
        {pending
          ? DATA_USAGE_LABELS.loadingDataUsage
          : DATA_USAGE_LABELS.usageUnavailable}
      </MiniAppStatus>
    );
  }

  const documentBreakdown = dataUsage.documents.breakdown
    .filter((entry) => entry.documentCount > 0 || entry.updateCount > 0)
    .map((entry) => ({
      byteLength: entry.byteLength,
      category: entry.category,
      detail: getDocumentUsageDetail(entry.documentCount, entry.updateCount),
    }));

  return (
    <div>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {DATA_USAGE_LABELS.organizationDataUsage}
        </MiniAppSectionHeading>
        <MiniAppStatus>{DATA_USAGE_LABELS.usageDefinition}</MiniAppStatus>
        {canSync === false && (
          <MiniAppStatus>{DATA_USAGE_LABELS.usageSyncOff}</MiniAppStatus>
        )}
        <UsageMetric
          byteLength={dataUsage.documents.byteLength}
          detail={getDocumentUsageDetail(
            dataUsage.documents.documentCount,
            dataUsage.documents.updateCount,
          )}
          label={DATA_USAGE_LABELS.usageDocuments}
        />
        <UsageBreakdown entries={documentBreakdown} />
        <UsageMetric
          byteLength={dataUsage.blobs.byteLength}
          detail={getBlobCountLabel(dataUsage.blobs.blobCount)}
          label={DATA_USAGE_LABELS.usageBlobs}
        />
        <UsageMetric
          byteLength={dataUsage.totalByteLength}
          detail={DATA_USAGE_LABELS.usageData}
          label={DATA_USAGE_LABELS.usageTotal}
        />
      </MiniAppSection>
    </div>
  );
}
