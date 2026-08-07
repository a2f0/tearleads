import { useMemo, useState } from "react";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import {
  DocumentRowDetailOverlay,
  type RowDetailField,
} from "./DocumentRowDetail";
import { TrackerReadActions } from "./TrackerReadActions";
import { type TrackerReadColumn, TrackerReadTable } from "./TrackerReadTable";
import type { TrackerIndexRow } from "./trackerIndexColumns";
import { resolveTrackerRowWriter, type TrackerRow } from "./trackerRows";

export function TrackerIndexTable<
  Row extends TrackerRow,
  IndexRow extends TrackerIndexRow<Row>,
>(params: {
  actionsAriaLabel: (row: IndexRow) => string;
  ariaLabel: string;
  buildRows: (rows: ReadonlyArray<Row>) => ReadonlyArray<IndexRow>;
  columnStorageKey: string;
  currentAuthorId: string | null;
  detailFields: (
    row: Row,
    resolveRowWriter?: RowWriterResolver | undefined,
  ) => ReadonlyArray<RowDetailField>;
  detailLabel: string;
  detailTitle: (row: IndexRow) => string;
  directAriaLabel: (row: IndexRow) => string;
  emptyLabel: string;
  entries: ReadonlyArray<Row>;
  getColumns: (context: {
    currentAuthorId: string | null;
    resolveRowWriter?: RowWriterResolver | undefined;
  }) => ReadonlyArray<TrackerReadColumn<IndexRow>>;
  onEnterEdit?: ((id: string) => void) | undefined;
  resolveRowWriter?: RowWriterResolver | undefined;
  showFieldValues?: boolean | undefined;
  sortMenuLabel: string;
}) {
  const {
    actionsAriaLabel,
    ariaLabel,
    buildRows,
    columnStorageKey,
    currentAuthorId,
    detailFields,
    detailLabel,
    detailTitle,
    directAriaLabel,
    emptyLabel,
    entries,
    getColumns,
    onEnterEdit,
    resolveRowWriter,
    showFieldValues,
    sortMenuLabel,
  } = params;
  const [detailRowId, setDetailRowId] = useState<string | null>(null);
  const rows = useMemo(() => buildRows(entries), [buildRows, entries]);
  const columns = useMemo(
    () => getColumns({ currentAuthorId, resolveRowWriter }),
    [currentAuthorId, getColumns, resolveRowWriter],
  );
  const detailRow = rows.find((row) => row.entry.id === detailRowId) ?? null;

  return (
    <>
      <TrackerReadTable
        actionsLabel="Actions"
        ariaLabel={ariaLabel}
        columns={columns}
        columnStorageKey={columnStorageKey}
        defaultSortColumnId="ordinal"
        emptyLabel={emptyLabel}
        renderActions={(row) => (
          <TrackerReadActions
            actionsAriaLabel={actionsAriaLabel(row)}
            detailLabel={detailLabel}
            detailsOpen={detailRowId === row.entry.id}
            directAriaLabel={directAriaLabel(row)}
            onEnterEdit={
              onEnterEdit ? () => onEnterEdit(row.entry.id) : undefined
            }
            onOpenDetails={() => setDetailRowId(row.entry.id)}
          />
        )}
        rowKey={(row) => row.entry.id}
        rows={rows}
        sortMenuLabel={sortMenuLabel}
      />
      {detailRow ? (
        <DocumentRowDetailOverlay
          createdAt={detailRow.entry.createdAt}
          createdBy={resolveTrackerRowWriter(
            detailRow.entry.createdByPeer,
            detailRow.entry.createdBy,
            resolveRowWriter,
          )}
          currentAuthorId={currentAuthorId}
          fields={[...detailFields(detailRow.entry, resolveRowWriter)]}
          onClose={() => setDetailRowId(null)}
          title={detailTitle(detailRow)}
          updatedAt={detailRow.entry.updatedAt}
          updatedBy={resolveTrackerRowWriter(
            detailRow.entry.updatedByPeer,
            detailRow.entry.updatedBy,
            resolveRowWriter,
          )}
          {...(showFieldValues === undefined ? {} : { showFieldValues })}
        />
      ) : null}
    </>
  );
}
