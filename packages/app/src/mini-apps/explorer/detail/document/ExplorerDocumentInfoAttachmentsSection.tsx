import type { DocumentInfo } from "@tearleads/client-sdk";
import { useMemo } from "react";
import {
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
import { EXPLORER_LABELS } from "../../labels";
import {
  ExplorerInfoRowDetailButton,
  type ExplorerInfoRowDetailOpeners,
  useExplorerInfoRowDetail,
} from "../row-detail/ExplorerInfoRowDetail";
import {
  type AttachmentDisplayRow,
  getAttachmentDetail,
  getExplorerDocumentInfoAttachmentRows,
  getLocalAttachmentDisplayRow,
  getRemoteAttachmentDisplayRow,
  type OpenBlobBrowserRoute,
} from "./explorerDocumentInfoAttachmentRows";

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
 * Folded, the name leads over State · Size · Time. Unfolded, the six columns
 * stay in their original order. Either way the name opens the row's detail,
 * which holds the slot and blob ids a folded row has no room for.
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

function getAttachmentRowKey(row: AttachmentDisplayRow): string {
  return row.key;
}

function AttachmentBlobButton(params: { row: AttachmentDisplayRow }) {
  const { blob } = params.row;
  return (
    <MiniAppTableActionButton disabled={blob.disabled} onClick={blob.open}>
      <MiniAppTableText>{blob.label}</MiniAppTableText>
    </MiniAppTableActionButton>
  );
}

function AttachmentNameButton(params: {
  openers: ExplorerInfoRowDetailOpeners;
  row: AttachmentDisplayRow;
}) {
  return (
    <ExplorerInfoRowDetailButton
      onOpen={params.openers.openFromControl}
      text={params.row.name.text}
      title={params.row.name.title}
    />
  );
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
  openers: ExplorerInfoRowDetailOpeners;
  row: AttachmentDisplayRow;
}) {
  const { compact, openers, row } = params;
  if (compact) {
    return (
      <MiniAppTableRow interactive onActivate={openers.openFromRow}>
        <MiniAppCompactTableCell
          primary={[
            {
              content: <AttachmentNameButton openers={openers} row={row} />,
              id: "name",
              title: row.name.title,
            },
          ]}
          secondary={[getAttachmentSecondaryField(row)]}
        />
      </MiniAppTableRow>
    );
  }

  return (
    <MiniAppTableRow interactive onActivate={openers.openFromRow}>
      <MiniAppTableCell>
        <MiniAppTableText title={row.kind.title}>
          {row.kind.text}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText title={row.slot.title}>
          {row.slot.text}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell title={row.blob.title}>
        <AttachmentBlobButton row={row} />
      </MiniAppTableCell>
      <MiniAppTableCell>
        <AttachmentNameButton openers={openers} row={row} />
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText>{row.size}</MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText title={row.time.title}>
          {row.time.text}
        </MiniAppTableText>
      </MiniAppTableCell>
    </MiniAppTableRow>
  );
}

function AttachmentsTable(params: {
  rows: ReadonlyArray<AttachmentDisplayRow>;
}) {
  const { compact, frameRef, rowHeight } = useMiniAppCompactTableFrame();
  const columns = useMemo(() => getAttachmentColumns(compact), [compact]);
  const { detailOverlay, getRowDetailOpeners } = useExplorerInfoRowDetail({
    getDetail: getAttachmentDetail,
    getKey: getAttachmentRowKey,
    rows: params.rows,
  });

  return (
    <>
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
            <AttachmentRow
              compact={compact}
              key={row.key}
              openers={getRowDetailOpeners(row)}
              row={row}
            />
          ))}
        </MiniAppTable>
      </MiniAppTableFrame>
      {detailOverlay}
    </>
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
