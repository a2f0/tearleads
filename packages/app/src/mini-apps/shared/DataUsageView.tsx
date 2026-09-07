import type { OrganizationDataUsage } from "@tearleads/client-sdk";
import type { OrganizationDocumentUsageCategory } from "@tearleads/validators/response";
import {
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../components/mini-app/rows/MiniAppRow";
import { formatByteLength } from "../../utils/formatByteLength";
import { DATA_USAGE_LABELS } from "./dataUsageLabels";
import "./DataUsageView.css";

const DOCUMENT_CATEGORY_LABELS: Record<
  OrganizationDocumentUsageCategory,
  string
> = {
  containerMetadata: DATA_USAGE_LABELS.usageCategoryContainerMetadata,
  organizationMetadata: DATA_USAGE_LABELS.usageCategoryOrganizationMetadata,
  rosterProfiles: DATA_USAGE_LABELS.usageCategoryRosterProfiles,
  user: DATA_USAGE_LABELS.usageCategoryUser,
};

function getUsageCountLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function getDocumentUsageDetail(
  documentCount: number,
  updateCount: number,
): string {
  return `${getUsageCountLabel(
    documentCount,
    DATA_USAGE_LABELS.usageDocument,
    DATA_USAGE_LABELS.usageDocumentsUnit,
  )}, ${getUsageCountLabel(
    updateCount,
    DATA_USAGE_LABELS.usageUpdate,
    DATA_USAGE_LABELS.usageUpdatesUnit,
  )}`;
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
    <MiniAppRow className="organization-usage-row" density="roomy">
      <MiniAppRowStack>
        <strong>{label}</strong>
        <MiniAppRowText muted>{detail}</MiniAppRowText>
      </MiniAppRowStack>
      <strong
        title={`${byteLength.toLocaleString()} ${DATA_USAGE_LABELS.usageBytesUnit}`}
      >
        {formatByteLength(byteLength)}
      </strong>
    </MiniAppRow>
  );
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

  const documentBreakdown = dataUsage.documents.breakdown.filter(
    (entry) => entry.documentCount > 0 || entry.updateCount > 0,
  );

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
        {documentBreakdown.length > 0 && (
          <div className="organization-usage-breakdown">
            {documentBreakdown.map((entry) => (
              <MiniAppRow
                className="organization-usage-subrow"
                density="compact"
                key={entry.category}
              >
                <MiniAppRowStack>
                  <MiniAppRowText>
                    {DOCUMENT_CATEGORY_LABELS[entry.category]}
                  </MiniAppRowText>
                  <MiniAppRowText muted>
                    {getDocumentUsageDetail(
                      entry.documentCount,
                      entry.updateCount,
                    )}
                  </MiniAppRowText>
                </MiniAppRowStack>
                <MiniAppRowText
                  muted
                  title={`${entry.byteLength.toLocaleString()} ${DATA_USAGE_LABELS.usageBytesUnit}`}
                >
                  {formatByteLength(entry.byteLength)}
                </MiniAppRowText>
              </MiniAppRow>
            ))}
          </div>
        )}
        <UsageMetric
          byteLength={dataUsage.blobs.byteLength}
          detail={getUsageCountLabel(
            dataUsage.blobs.blobCount,
            DATA_USAGE_LABELS.usageBlob,
            DATA_USAGE_LABELS.usageBlobsUnit,
          )}
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
