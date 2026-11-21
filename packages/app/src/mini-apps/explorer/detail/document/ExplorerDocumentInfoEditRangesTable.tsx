import type { DocumentAttributionRangesPage } from "@tearleads/client-sdk";
import { useMemo } from "react";
import {
  MiniAppCompactTableCell,
  type MiniAppCompactTableField,
  MiniAppCompactTableHeader,
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
  useMiniAppCompactTableFrame,
} from "../../../../components/mini-app/MiniAppTable";
import { getMiniAppVirtualFrameStyle } from "../../../../components/mini-app/virtual/MiniAppVirtual";
import { classNames } from "../../../../components/shared/classNames";
import { formatMiniAppDateTimeSeconds } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
import {
  type ExplorerAttributionUserLabelResolver,
  getExplorerAttributionWriterLabel,
  getExplorerAttributionWriterTitle,
} from "../attributionDisplay";
import { compactId } from "../compactId";
import {
  type ExplorerInfoRowDetail,
  ExplorerInfoRowDetailButton,
  type ExplorerInfoRowDetailOpeners,
  useExplorerInfoRowDetail,
} from "../row-detail/ExplorerInfoRowDetail";

type EditRangeItem = DocumentAttributionRangesPage["items"][number];

function getEditRangeKey(item: EditRangeItem): string {
  return `${item.updateId}:${item.peerId}:${item.startCounter}:${item.endCounter}`;
}

/**
 * Every column after Writer, in order. Unfolded they are the table's columns;
 * folded they share the muted second line under the writer.
 */
const EDIT_RANGE_SECONDARY_COLUMNS = [
  { id: "peer", label: EXPLORER_LABELS.documentInfoEditRangePeerColumn },
  { id: "range", label: EXPLORER_LABELS.documentInfoEditRangeRangeColumn },
  { id: "ops", label: EXPLORER_LABELS.documentInfoEditRangeOpsColumn },
  { id: "upload", label: EXPLORER_LABELS.documentInfoEditRangeUploadColumn },
  {
    id: "authority",
    label: EXPLORER_LABELS.documentInfoEditRangeAuthorityColumn,
  },
] as const;

function getEditRangeAuthorityLabel(
  authorityKind: EditRangeItem["authorityKind"],
): string {
  return authorityKind === "direct"
    ? EXPLORER_LABELS.documentInfoEditRangeAuthorityDirect
    : EXPLORER_LABELS.documentInfoEditRangeAuthorityReasserted;
}

function getEditRangeSpan(item: EditRangeItem): string {
  return `${item.startCounter}–${item.endCounter}`;
}

function getEditRangeOpCount(item: EditRangeItem): string {
  return String(item.endCounter - item.startCounter);
}

function getEditRangeColumns(
  compact: boolean,
): ReadonlyArray<MiniAppTableColumn> {
  const writer = {
    id: "writer",
    text: EXPLORER_LABELS.documentInfoEditRangeWriterColumn,
  };
  if (compact) {
    return [
      {
        header: (
          <MiniAppCompactTableHeader
            primary={[writer]}
            secondary={EDIT_RANGE_SECONDARY_COLUMNS.map((column) => ({
              id: column.id,
              text: column.label,
            }))}
          />
        ),
        id: "summary",
      },
    ];
  }

  return [
    { header: writer.text, id: writer.id },
    ...EDIT_RANGE_SECONDARY_COLUMNS.map((column) => ({
      header: column.label,
      id: column.id,
    })),
  ];
}

function getEditRangeSecondaryFields(
  item: EditRangeItem,
): ReadonlyArray<MiniAppCompactTableField> {
  const [peer, range, ops, upload, authority] = EDIT_RANGE_SECONDARY_COLUMNS;
  return [
    { ...peer, text: compactId(item.peerId), title: item.peerId },
    { ...range, text: getEditRangeSpan(item) },
    { ...ops, text: getEditRangeOpCount(item) },
    { ...upload, text: compactId(item.updateId), title: item.updateId },
    { ...authority, text: getEditRangeAuthorityLabel(item.authorityKind) },
  ];
}

function getEditRangeDetail(
  item: EditRangeItem,
  attributionUserLabelResolver:
    | ExplorerAttributionUserLabelResolver
    | undefined,
): ExplorerInfoRowDetail {
  const [peer, range, ops, upload, authority] = EDIT_RANGE_SECONDARY_COLUMNS;
  return {
    fields: [
      {
        id: "writer",
        label: EXPLORER_LABELS.documentInfoEditRangeWriterColumn,
        value: getExplorerAttributionWriterLabel(
          item,
          attributionUserLabelResolver,
        ),
      },
      {
        copyable: true,
        id: "writerUserId",
        label: EXPLORER_LABELS.infoRowDetailWriterUserIdRow,
        value: item.writerUserId,
      },
      {
        copyable: true,
        id: "writerKey",
        label: EXPLORER_LABELS.infoRowDetailWriterKeyRow,
        value: item.writerKeyFingerprint,
      },
      { ...peer, copyable: true, value: item.peerId },
      { ...range, value: getEditRangeSpan(item) },
      { ...ops, value: getEditRangeOpCount(item) },
      { ...upload, copyable: true, value: item.updateId },
      // When the server stored the upload, by its own clock, and the time
      // its writer signed, by theirs.
      {
        id: "uploadStoredAt",
        label: EXPLORER_LABELS.infoRowDetailUploadStoredRow,
        value: formatMiniAppDateTimeSeconds(item.createdAt),
      },
      {
        id: "uploadSignedAt",
        label: EXPLORER_LABELS.infoRowDetailUploadSignedRow,
        value: formatMiniAppDateTimeSeconds(item.signedAt),
      },
      { ...authority, value: getEditRangeAuthorityLabel(item.authorityKind) },
    ],
    title: EXPLORER_LABELS.infoRowDetailEditRangeTitle,
  };
}

function EditRangeRow(params: {
  attributionUserLabelResolver:
    | ExplorerAttributionUserLabelResolver
    | undefined;
  compact: boolean;
  item: EditRangeItem;
  openers: ExplorerInfoRowDetailOpeners;
}) {
  const { attributionUserLabelResolver, compact, item, openers } = params;
  const title = getExplorerAttributionWriterTitle(
    item,
    attributionUserLabelResolver,
  );
  const writer = {
    content: (
      <ExplorerInfoRowDetailButton
        onOpen={openers.openFromControl}
        text={getExplorerAttributionWriterLabel(
          item,
          attributionUserLabelResolver,
        )}
        title={title}
      />
    ),
    id: "writer",
    title,
  };
  const secondary = getEditRangeSecondaryFields(item);

  return (
    <MiniAppTableRow interactive onActivate={openers.openFromRow}>
      {compact ? (
        <MiniAppCompactTableCell primary={[writer]} secondary={secondary} />
      ) : (
        <>
          <MiniAppTableCell>{writer.content}</MiniAppTableCell>
          {secondary.map((field) => (
            <MiniAppTableCell key={field.id}>
              <MiniAppTableText title={field.title}>
                {field.text}
              </MiniAppTableText>
            </MiniAppTableCell>
          ))}
        </>
      )}
    </MiniAppTableRow>
  );
}

export function EditRangesTable(params: {
  attributionUserLabelResolver?:
    | ExplorerAttributionUserLabelResolver
    | undefined;
  items: DocumentAttributionRangesPage["items"];
}) {
  const { compact, frameRef, rowHeight } = useMiniAppCompactTableFrame();
  const columns = useMemo(() => getEditRangeColumns(compact), [compact]);
  const { detailOverlay, getRowDetailOpeners } = useExplorerInfoRowDetail({
    getDetail: (item) =>
      getEditRangeDetail(item, params.attributionUserLabelResolver),
    getKey: getEditRangeKey,
    rows: params.items,
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
          aria-label={EXPLORER_LABELS.documentInfoEditRangesHeading}
          columns={columns}
        >
          {params.items.map((item) => (
            <EditRangeRow
              attributionUserLabelResolver={params.attributionUserLabelResolver}
              compact={compact}
              item={item}
              key={getEditRangeKey(item)}
              openers={getRowDetailOpeners(item)}
            />
          ))}
        </MiniAppTable>
      </MiniAppTableFrame>
      {detailOverlay}
    </>
  );
}
