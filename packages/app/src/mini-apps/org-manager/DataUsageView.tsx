import {
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import type { OrgManagerDataUsage } from "../../stores/org-manager/OrgManagerProvider";
import { formatByteLength } from "../../utils/formatByteLength";
import { ORG_MANAGER_LABELS } from "./labels";

function getUsageCountLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function UsageMetric({
  byteLength,
  detail,
  label,
}: {
  byteLength: number;
  detail: string;
  label: string;
}) {
  return (
    <MiniAppRow className="org-manager-usage-row" density="roomy">
      <MiniAppRowStack>
        <strong>{label}</strong>
        <MiniAppRowText muted>{detail}</MiniAppRowText>
      </MiniAppRowStack>
      <strong
        title={`${byteLength.toLocaleString()} ${ORG_MANAGER_LABELS.usageBytesUnit}`}
      >
        {formatByteLength(byteLength)}
      </strong>
    </MiniAppRow>
  );
}

export function DataUsageView({
  dataUsage,
  loading,
}: {
  dataUsage: OrgManagerDataUsage | null;
  loading: boolean;
}) {
  if (!dataUsage) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {loading
          ? ORG_MANAGER_LABELS.loadingDataUsage
          : ORG_MANAGER_LABELS.usageUnavailable}
      </MiniAppStatus>
    );
  }

  return (
    <div>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.organizationDataUsage}
        </MiniAppSectionHeading>
        <UsageMetric
          byteLength={dataUsage.totalByteLength}
          detail={ORG_MANAGER_LABELS.usageData}
          label={ORG_MANAGER_LABELS.usageTotal}
        />
      </MiniAppSection>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.usageDocuments}
        </MiniAppSectionHeading>
        <UsageMetric
          byteLength={dataUsage.documents.byteLength}
          detail={`${getUsageCountLabel(
            dataUsage.documents.documentCount,
            ORG_MANAGER_LABELS.usageDocument,
            ORG_MANAGER_LABELS.usageDocumentsUnit,
          )}, ${getUsageCountLabel(
            dataUsage.documents.updateCount,
            ORG_MANAGER_LABELS.usageUpdate,
            ORG_MANAGER_LABELS.usageUpdatesUnit,
          )}`}
          label={ORG_MANAGER_LABELS.usageDocuments}
        />
      </MiniAppSection>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.usageBlobs}
        </MiniAppSectionHeading>
        <UsageMetric
          byteLength={dataUsage.blobs.byteLength}
          detail={getUsageCountLabel(
            dataUsage.blobs.blobCount,
            ORG_MANAGER_LABELS.usageBlob,
            ORG_MANAGER_LABELS.usageBlobsUnit,
          )}
          label={ORG_MANAGER_LABELS.usageBlobs}
        />
      </MiniAppSection>
    </div>
  );
}
