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
  useMiniAppCompactTableFrame,
} from "../../../../components/mini-app/MiniAppTable";
import { getMiniAppVirtualFrameStyle } from "../../../../components/mini-app/virtual/MiniAppVirtual";
import { classNames } from "../../../../components/shared/classNames";
import { EXPLORER_LABELS } from "../../labels";
import {
  type ExplorerAttributionUserLabelResolver,
  getExplorerAttributionWriterLabel,
  getExplorerAttributionWriterTitle,
} from "../attributionDisplay";
import { compactId } from "../compactId";

type EditRangeItem = DocumentAttributionRangesPage["items"][number];

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
    { ...range, text: `${item.startCounter}–${item.endCounter}` },
    { ...ops, text: String(item.endCounter - item.startCounter) },
    { ...upload, text: compactId(item.updateId), title: item.updateId },
    { ...authority, text: getEditRangeAuthorityLabel(item.authorityKind) },
  ];
}

function EditRangeRow(params: {
  attributionUserLabelResolver:
    | ExplorerAttributionUserLabelResolver
    | undefined;
  compact: boolean;
  item: EditRangeItem;
}) {
  const { attributionUserLabelResolver, compact, item } = params;
  const writer = {
    id: "writer",
    text: getExplorerAttributionWriterLabel(item, attributionUserLabelResolver),
    title: getExplorerAttributionWriterTitle(
      item,
      attributionUserLabelResolver,
    ),
  };
  const secondary = getEditRangeSecondaryFields(item);

  return (
    <MiniAppTableRow>
      {compact ? (
        <MiniAppCompactTableCell primary={[writer]} secondary={secondary} />
      ) : (
        <>
          <MiniAppTableCell title={writer.title}>
            {writer.text}
          </MiniAppTableCell>
          {secondary.map((field) => (
            <MiniAppTableCell key={field.id} title={field.title}>
              {field.text}
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
        aria-label={EXPLORER_LABELS.documentInfoEditRangesHeading}
        columns={columns}
      >
        {params.items.map((item) => (
          <EditRangeRow
            attributionUserLabelResolver={params.attributionUserLabelResolver}
            compact={compact}
            item={item}
            key={`${item.updateId}:${item.peerId}:${item.startCounter}:${item.endCounter}`}
          />
        ))}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
