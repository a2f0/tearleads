import type { OrganizationDocumentUsageCategory } from "@tearleads/validators/response";
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

export function getUsageCountLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

export function getDocumentCountLabel(documentCount: number): string {
  return getUsageCountLabel(
    documentCount,
    DATA_USAGE_LABELS.usageDocument,
    DATA_USAGE_LABELS.usageDocumentsUnit,
  );
}

export function getBlobCountLabel(blobCount: number): string {
  return getUsageCountLabel(
    blobCount,
    DATA_USAGE_LABELS.usageBlob,
    DATA_USAGE_LABELS.usageBlobsUnit,
  );
}

/** One top-level usage line: a label and detail beside its formatted size. */
export function UsageMetric({
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

interface UsageBreakdownEntry {
  readonly byteLength: number;
  readonly category: OrganizationDocumentUsageCategory;
  readonly detail: string;
}

/** The per-category document lines nested under the Documents metric. */
export function UsageBreakdown({
  entries,
}: {
  entries: ReadonlyArray<UsageBreakdownEntry>;
}) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="organization-usage-breakdown">
      {entries.map((entry) => (
        <MiniAppRow
          className="organization-usage-subrow"
          density="compact"
          key={entry.category}
        >
          <MiniAppRowStack>
            <MiniAppRowText>
              {DOCUMENT_CATEGORY_LABELS[entry.category]}
            </MiniAppRowText>
            <MiniAppRowText muted>{entry.detail}</MiniAppRowText>
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
  );
}
