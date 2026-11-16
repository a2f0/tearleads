import type { DocumentInfo } from "@tearleads/client-sdk";
import { useMemo } from "react";
import {
  MiniAppButton,
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppCompactTableCell,
  type MiniAppCompactTableField,
  MiniAppCompactTableHeader,
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  useMiniAppCompactTableFrame,
} from "../../../../components/mini-app/MiniAppTable";
import { getMiniAppVirtualFrameStyle } from "../../../../components/mini-app/virtual/MiniAppVirtual";
import { classNames } from "../../../../components/shared/classNames";
import { formatByteLength } from "../../../../utils/formatByteLength";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import {
  EXPLORER_LABELS,
  getExplorerDocumentInfoAttachmentKindLabel,
} from "../../labels";
import { compactId } from "../compactId";

export type OpenBlobBrowserRoute = (input?: {
  blobId?: string | null | undefined;
  storageKey?: string | null | undefined;
}) => void;

type DocumentInfoAttachment = DocumentInfo["attachments"][number];
type DocumentInfoRemoteAttachmentBinding = NonNullable<
  DocumentInfo["remoteInfo"]
>["activeAttachmentBindings"][number];

interface LocalDocumentInfoAttachmentRow {
  attachment: DocumentInfoAttachment;
  remoteBinding: DocumentInfoRemoteAttachmentBinding | null;
  state: "local" | "local-remote" | "pending";
}

interface RemoteDocumentInfoAttachmentRow {
  binding: DocumentInfoRemoteAttachmentBinding;
  state: "remote";
}

function getAttachmentRemoteBindingKey(input: {
  blobId: string | null;
  slotId: string;
}): string | null {
  return input.blobId ? `${input.slotId}\u0000${input.blobId}` : null;
}

function getExplorerDocumentInfoAttachmentRows(input: {
  attachments: ReadonlyArray<DocumentInfoAttachment>;
  remoteBindings: ReadonlyArray<DocumentInfoRemoteAttachmentBinding>;
}): {
  localRows: LocalDocumentInfoAttachmentRow[];
  remoteRows: RemoteDocumentInfoAttachmentRow[];
} {
  const matchedRemoteBindingIds = new Set<string>();
  const remoteBindingsByKey = new Map<
    string,
    DocumentInfoRemoteAttachmentBinding[]
  >();

  for (const binding of input.remoteBindings) {
    const key = getAttachmentRemoteBindingKey(binding);
    if (key) {
      const bindings = remoteBindingsByKey.get(key);
      if (bindings) {
        bindings.push(binding);
      } else {
        remoteBindingsByKey.set(key, [binding]);
      }
    }
  }

  const localRows = input.attachments.map(
    (attachment): LocalDocumentInfoAttachmentRow => {
      const key =
        attachment.attachmentKind === "local"
          ? getAttachmentRemoteBindingKey(attachment)
          : null;
      const bindings = key ? remoteBindingsByKey.get(key) : null;
      const remoteBinding = bindings?.shift() ?? null;
      if (remoteBinding) {
        matchedRemoteBindingIds.add(remoteBinding.bindingId);
      }

      return {
        attachment,
        remoteBinding,
        state: remoteBinding ? "local-remote" : attachment.attachmentKind,
      };
    },
  );

  return {
    localRows,
    remoteRows: input.remoteBindings
      .filter((binding) => !matchedRemoteBindingIds.has(binding.bindingId))
      .map((binding) => ({ binding, state: "remote" })),
  };
}

/** One attachment row as shown, whichever side (local or remote) it came from. */
interface AttachmentDisplayRow {
  blob: {
    disabled: boolean;
    label: string;
    open: () => void;
    title?: string | undefined;
  };
  key: string;
  kind: { text: string; title?: string | undefined };
  name: { text: string; title: string };
  size: string;
  slot: { text: string; title: string };
  time: { text: string; title?: string | undefined };
}

function getLocalAttachmentDisplayRow(
  row: LocalDocumentInfoAttachmentRow,
  openBlobBrowserRoute: OpenBlobBrowserRoute,
): AttachmentDisplayRow {
  const { attachment, remoteBinding } = row;
  const time = attachment.createdAt ?? attachment.updatedAt;
  return {
    blob: {
      disabled: !attachment.blobId && !attachment.storageKey,
      label: compactId(attachment.blobId ?? attachment.storageKey),
      open: () =>
        openBlobBrowserRoute({
          blobId: attachment.blobId,
          storageKey: attachment.storageKey,
        }),
      title: attachment.blobId ?? undefined,
    },
    key: `${row.state}:${attachment.slotId}:${attachment.blobId ?? ""}:${attachment.storageKey}`,
    kind: {
      text: getExplorerDocumentInfoAttachmentKindLabel(row.state),
      title: remoteBinding?.bindingId ?? undefined,
    },
    name: {
      text: attachment.name ?? attachment.mimeType ?? "-",
      title: remoteBinding
        ? `${attachment.storageKey} ${remoteBinding.bindingId}`
        : attachment.storageKey,
    },
    size: formatByteLength(attachment.byteLength),
    slot: { text: compactId(attachment.slotId), title: attachment.slotId },
    time: {
      text: formatMiniAppDateTime(time, { emptyFallback: "-" }),
      title: time ?? undefined,
    },
  };
}

function getRemoteAttachmentDisplayRow(
  row: RemoteDocumentInfoAttachmentRow,
  openBlobBrowserRoute: OpenBlobBrowserRoute,
): AttachmentDisplayRow {
  const { binding } = row;
  return {
    blob: {
      disabled: false,
      label: compactId(binding.blobId),
      open: () => openBlobBrowserRoute({ blobId: binding.blobId }),
      title: binding.blobId,
    },
    key: `remote:${binding.bindingId}`,
    kind: { text: getExplorerDocumentInfoAttachmentKindLabel(row.state) },
    name: { text: compactId(binding.bindingId), title: binding.bindingId },
    size: "-",
    slot: { text: compactId(binding.slotId), title: binding.slotId },
    time: { text: "-" },
  };
}

/**
 * The folded row's muted second line: State · Size · Time as one joined field,
 * since each value is self-describing and three equal-width fields would each
 * truncate on a phone. Shared by the header label and the body text.
 */
const ATTACHMENT_SECONDARY_COLUMNS = [
  EXPLORER_LABELS.documentInfoAttachmentKindColumn,
  EXPLORER_LABELS.documentInfoAttachmentSizeColumn,
  EXPLORER_LABELS.documentInfoAttachmentTimeColumn,
] as const;

const ATTACHMENT_SECONDARY_SEPARATOR = " · ";

const ATTACHMENT_SECONDARY_LABEL = ATTACHMENT_SECONDARY_COLUMNS.join(
  ATTACHMENT_SECONDARY_SEPARATOR,
);

/**
 * Folded, the name leads (as the open-in-blob-browser button when there is a
 * blob) over State · Size · Time. Unfolded, the six columns stay in their
 * original order.
 */
function getAttachmentColumns(
  compact: boolean,
): ReadonlyArray<MiniAppTableColumn> {
  if (compact) {
    return [
      {
        header: (
          <MiniAppCompactTableHeader
            primary={[
              {
                id: "name",
                text: EXPLORER_LABELS.documentInfoAttachmentNameColumn,
              },
            ]}
            secondary={[{ id: "details", text: ATTACHMENT_SECONDARY_LABEL }]}
          />
        ),
        id: "summary",
      },
    ];
  }

  return [
    { header: EXPLORER_LABELS.documentInfoAttachmentKindColumn, id: "kind" },
    { header: EXPLORER_LABELS.documentInfoAttachmentSlotColumn, id: "slot" },
    { header: EXPLORER_LABELS.documentInfoAttachmentBlobColumn, id: "blob" },
    { header: EXPLORER_LABELS.documentInfoAttachmentNameColumn, id: "name" },
    { header: EXPLORER_LABELS.documentInfoAttachmentSizeColumn, id: "size" },
    { header: EXPLORER_LABELS.documentInfoAttachmentTimeColumn, id: "time" },
  ];
}

function AttachmentBlobButton(params: { row: AttachmentDisplayRow }) {
  const { blob } = params.row;
  return (
    <MiniAppButton disabled={blob.disabled} onClick={blob.open} variant="ghost">
      {blob.label}
    </MiniAppButton>
  );
}

function getAttachmentPrimaryField(
  row: AttachmentDisplayRow,
): MiniAppCompactTableField {
  if (row.blob.disabled) {
    return { id: "name", ...row.name };
  }

  // Folded there is no Blob column, so the name carries the same
  // open-in-blob-browser action the unfolded Blob button does.
  return {
    content: (
      <MiniAppTableActionButton onClick={row.blob.open}>
        <MiniAppTableText title={row.name.title}>
          {row.name.text}
        </MiniAppTableText>
      </MiniAppTableActionButton>
    ),
    id: "name",
    title: row.name.title,
  };
}

function getAttachmentSecondaryField(
  row: AttachmentDisplayRow,
): MiniAppCompactTableField {
  const title = [row.kind.title, row.time.title].filter(Boolean).join(" ");
  return {
    id: "details",
    label: ATTACHMENT_SECONDARY_LABEL,
    text: [row.kind.text, row.size, row.time.text].join(
      ATTACHMENT_SECONDARY_SEPARATOR,
    ),
    title: title || undefined,
  };
}

function AttachmentRow(params: {
  compact: boolean;
  row: AttachmentDisplayRow;
}) {
  const { compact, row } = params;
  if (compact) {
    return (
      <MiniAppTableRow>
        <MiniAppCompactTableCell
          primary={[getAttachmentPrimaryField(row)]}
          secondary={[getAttachmentSecondaryField(row)]}
        />
      </MiniAppTableRow>
    );
  }

  return (
    <MiniAppTableRow>
      <MiniAppTableCell title={row.kind.title}>
        {row.kind.text}
      </MiniAppTableCell>
      <MiniAppTableCell title={row.slot.title}>
        {row.slot.text}
      </MiniAppTableCell>
      <MiniAppTableCell title={row.blob.title}>
        <AttachmentBlobButton row={row} />
      </MiniAppTableCell>
      <MiniAppTableCell title={row.name.title}>
        {row.name.text}
      </MiniAppTableCell>
      <MiniAppTableCell>{row.size}</MiniAppTableCell>
      <MiniAppTableCell title={row.time.title}>
        {row.time.text}
      </MiniAppTableCell>
    </MiniAppTableRow>
  );
}

function AttachmentsTable(params: {
  rows: ReadonlyArray<AttachmentDisplayRow>;
}) {
  const { compact, frameRef, rowHeight } = useMiniAppCompactTableFrame();
  const columns = useMemo(() => getAttachmentColumns(compact), [compact]);

  return (
    <MiniAppTableFrame
      className={classNames(
        compact &&
          "mini-app-table-frame--compact mini-app-table-frame--two-line",
      )}
      ref={frameRef}
      style={getMiniAppVirtualFrameStyle(rowHeight)}
    >
      <MiniAppTable
        aria-label={EXPLORER_LABELS.documentInfoAttachmentsHeading}
        columns={columns}
      >
        {params.rows.map((row) => (
          <AttachmentRow compact={compact} key={row.key} row={row} />
        ))}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

export function ExplorerDocumentInfoAttachmentsSection(params: {
  documentInfo: DocumentInfo;
  openBlobBrowserRoute: OpenBlobBrowserRoute;
}) {
  const { attachments, remoteInfo } = params.documentInfo;
  const remoteBindings = remoteInfo?.activeAttachmentBindings ?? [];
  const { localRows, remoteRows } = getExplorerDocumentInfoAttachmentRows({
    attachments,
    remoteBindings,
  });
  const rows = [
    ...localRows.map((row) =>
      getLocalAttachmentDisplayRow(row, params.openBlobBrowserRoute),
    ),
    ...remoteRows.map((row) =>
      getRemoteAttachmentDisplayRow(row, params.openBlobBrowserRoute),
    ),
  ];

  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.documentInfoAttachmentsHeading}
    >
      {rows.length === 0 ? (
        <MiniAppStatus>
          {EXPLORER_LABELS.documentInfoNoAttachments}
        </MiniAppStatus>
      ) : (
        <AttachmentsTable rows={rows} />
      )}
    </MiniAppInfoSection>
  );
}
