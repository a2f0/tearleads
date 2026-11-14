import type { PendingBlobDeletion } from "@tearleads/client-sdk";
import {
  MiniAppTable,
  MiniAppTableCell,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
  useMiniAppCompactTableFrame,
} from "../../../components/mini-app/MiniAppTable";
import { formatByteLength } from "../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import "./PendingBlobDeletionTable.css";

const STATUS_LABELS = {
  "grace-period": "Grace period",
  eligible: "Eligible for collection",
  "deletion-pending": "Object deletion pending",
} satisfies Record<PendingBlobDeletion["status"], string>;
const COLUMNS = [
  { id: "blob", header: "Blob" },
  { id: "size", header: "Encrypted size", width: "7rem" },
  { id: "cleanup", header: "Cleanup" },
  { id: "timeline", header: "Timeline" },
];

function BlobTimeline({ blob }: { blob: PendingBlobDeletion }) {
  const dates = [
    ["Dereferenced", blob.dereferencedAt],
    ["Eligible after", blob.eligibleAfter],
    ["Live state pruned", blob.prunedAt],
    ["Last reclaim attempt", blob.reclaimAttemptedAt],
    ["Last object deletion attempt", blob.objectDeleteAttemptedAt],
  ] as const;
  return (
    <dl className="pending-blob-deletion-timeline">
      {dates.map(([label, value]) =>
        value === null ? null : (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <time dateTime={value}>{formatMiniAppDateTime(value)}</time>
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}

function BlobIdentity({
  blob,
  showOrganization,
}: {
  blob: PendingBlobDeletion;
  showOrganization: boolean;
}) {
  return (
    <div className="pending-blob-deletion-identity">
      <span>{blob.blobId}</span>
      {showOrganization && <span>Organization: {blob.organizationId}</span>}
    </div>
  );
}

export function PendingBlobDeletionTable({
  rows,
  loading,
  showOrganization,
}: {
  rows: ReadonlyArray<PendingBlobDeletion>;
  loading: boolean;
  showOrganization: boolean;
}) {
  const { compact, frameRef } = useMiniAppCompactTableFrame();
  const columns = compact
    ? [{ id: "blob", header: "Pending deletion" }]
    : COLUMNS;
  return (
    <MiniAppTableFrame ref={frameRef}>
      <MiniAppTable aria-label="Pending blob deletions" columns={columns}>
        {rows.length === 0 ? (
          <MiniAppTableEmptyRow colSpan={columns.length}>
            {loading
              ? "Loading pending deletions..."
              : "No blobs are pending deletion."}
          </MiniAppTableEmptyRow>
        ) : (
          rows.map((blob) => (
            <MiniAppTableRow key={blob.blobId}>
              {compact ? (
                <MiniAppTableCell>
                  <BlobIdentity
                    blob={blob}
                    showOrganization={showOrganization}
                  />
                  <p>
                    {formatByteLength(blob.byteLength)} ·{" "}
                    {STATUS_LABELS[blob.status]}
                  </p>
                  <BlobTimeline blob={blob} />
                </MiniAppTableCell>
              ) : (
                <>
                  <MiniAppTableCell>
                    <BlobIdentity
                      blob={blob}
                      showOrganization={showOrganization}
                    />
                  </MiniAppTableCell>
                  <MiniAppTableCell
                    title={`${blob.byteLength.toLocaleString()} bytes`}
                  >
                    {formatByteLength(blob.byteLength)}
                  </MiniAppTableCell>
                  <MiniAppTableCell>
                    {STATUS_LABELS[blob.status]}
                  </MiniAppTableCell>
                  <MiniAppTableCell>
                    <BlobTimeline blob={blob} />
                  </MiniAppTableCell>
                </>
              )}
            </MiniAppTableRow>
          ))
        )}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
