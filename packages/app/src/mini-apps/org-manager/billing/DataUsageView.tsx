import type { OrganizationDataUsage } from "@symcrypt/client-sdk";
import type { OrganizationDocumentUsageCategory } from "@symcrypt/validators/response";
import {
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import { formatByteLength } from "../../../utils/formatByteLength";
import { ORG_MANAGER_LABELS } from "../labels";

const DOCUMENT_CATEGORY_LABELS: Record<
  OrganizationDocumentUsageCategory,
  string
> = {
  containerMetadata: ORG_MANAGER_LABELS.usageCategoryContainerMetadata,
  organizationMetadata: ORG_MANAGER_LABELS.usageCategoryOrganizationMetadata,
  rosterProfiles: ORG_MANAGER_LABELS.usageCategoryRosterProfiles,
  user: ORG_MANAGER_LABELS.usageCategoryUser,
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
    ORG_MANAGER_LABELS.usageDocument,
    ORG_MANAGER_LABELS.usageDocumentsUnit,
  )}, ${getUsageCountLabel(
    updateCount,
    ORG_MANAGER_LABELS.usageUpdate,
    ORG_MANAGER_LABELS.usageUpdatesUnit,
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
      <MiniAppStatus className="org-manager-hint">
        {pending
          ? ORG_MANAGER_LABELS.loadingDataUsage
          : ORG_MANAGER_LABELS.usageUnavailable}
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
          {ORG_MANAGER_LABELS.organizationDataUsage}
        </MiniAppSectionHeading>
        <MiniAppStatus className="org-manager-hint">
          {ORG_MANAGER_LABELS.usageDefinition}
        </MiniAppStatus>
        {canSync === false && (
          <MiniAppStatus className="org-manager-hint">
            {ORG_MANAGER_LABELS.usageSyncOff}
          </MiniAppStatus>
        )}
        <UsageMetric
          byteLength={dataUsage.documents.byteLength}
          detail={getDocumentUsageDetail(
            dataUsage.documents.documentCount,
            dataUsage.documents.updateCount,
          )}
          label={ORG_MANAGER_LABELS.usageDocuments}
        />
        {documentBreakdown.length > 0 && (
          <div className="org-manager-usage-breakdown">
            {documentBreakdown.map((entry) => (
              <MiniAppRow
                className="org-manager-usage-subrow"
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
                  title={`${entry.byteLength.toLocaleString()} ${ORG_MANAGER_LABELS.usageBytesUnit}`}
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
            ORG_MANAGER_LABELS.usageBlob,
            ORG_MANAGER_LABELS.usageBlobsUnit,
          )}
          label={ORG_MANAGER_LABELS.usageBlobs}
        />
        <UsageMetric
          byteLength={dataUsage.totalByteLength}
          detail={ORG_MANAGER_LABELS.usageData}
          label={ORG_MANAGER_LABELS.usageTotal}
        />
      </MiniAppSection>
    </div>
  );
}
