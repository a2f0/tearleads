import { Fragment, type ReactNode, useState } from "react";
import { classNames } from "../../components/shared/classNames";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import { useStructuredDocumentEditAction } from "./StructuredDocument";
import type { TrackerRow } from "./trackerRows";
import { type AddTrackerRow, useSavedTrackerRows } from "./useSavedTrackerRows";

interface TrackerRenderContext {
  controlsDisabled: boolean;
  onPendingChange: (pending: boolean) => void;
}

interface TrackerDocumentProps<Row extends TrackerRow, QuickEntry> {
  currentAuthorId?: string | null;
  disabled?: boolean | undefined;
  editingRowId?: string | null | undefined;
  editActionId: string;
  emptyLabel: string;
  footerClassName?: string | undefined;
  isEditing?: boolean | undefined;
  listClassName?: string | undefined;
  listLabel: string;
  onAddRow: AddTrackerRow<QuickEntry>;
  onEnterEdit?: ((id: string) => void) | undefined;
  onToggleEditing: () => void;
  ready: boolean;
  renderEditRow: (
    row: Row,
    index: number,
    context: TrackerRenderContext & { onSave: () => void },
  ) => ReactNode;
  renderEditFields: (controlsDisabled: boolean) => ReactNode;
  renderQuickAdd: (
    context: TrackerRenderContext & {
      onAddRow: AddTrackerRow<QuickEntry>;
    },
  ) => ReactNode;
  renderReadRow: (
    row: Row,
    index: number,
    rows: ReadonlyArray<Row>,
    context: {
      currentAuthorId: string | null;
      onEnterEdit: () => void;
      resolveRowWriter?: RowWriterResolver | undefined;
    },
  ) => ReactNode;
  renderReadTable: (context: {
    currentAuthorId: string | null;
    onEnterEdit?: ((id: string) => void) | undefined;
    resolveRowWriter?: RowWriterResolver | undefined;
  }) => ReactNode;
  resolveRowWriter?: RowWriterResolver | undefined;
  rows: ReadonlyArray<Row>;
}

function TrackerEditFields<Row extends TrackerRow, QuickEntry>(
  params: Omit<
    TrackerDocumentProps<Row, QuickEntry>,
    "disabled" | "editActionId" | "isEditing" | "onToggleEditing" | "ready"
  > & {
    controlsDisabled: boolean;
    editingRowId: string | null;
    entryPending: boolean;
    onPendingChange: (pending: boolean) => void;
  },
) {
  const {
    controlsDisabled,
    currentAuthorId = null,
    editingRowId,
    emptyLabel,
    entryPending,
    footerClassName,
    listClassName,
    listLabel,
    onAddRow,
    onPendingChange,
    renderEditRow,
    renderEditFields,
    renderQuickAdd,
    renderReadRow,
    resolveRowWriter,
    rows,
  } = params;
  const { isRowSaved, saveAddedRow, setRowSaved } = useSavedTrackerRows(
    rows,
    editingRowId,
  );

  return (
    <div className="tracker-document-fields">
      {renderEditFields(controlsDisabled)}
      <section className={classNames("tracker-entry-list", listClassName)}>
        <strong>{listLabel}</strong>
        {renderQuickAdd({
          controlsDisabled,
          onAddRow: (entry) => {
            const addedRow = onAddRow(entry);
            void saveAddedRow(addedRow);
            return addedRow;
          },
          onPendingChange,
        })}
        {rows.length === 0 && !entryPending ? (
          <div className="tracker-empty-state">{emptyLabel}</div>
        ) : null}
        {rows.map((row, index) => (
          <Fragment key={row.id}>
            {isRowSaved(row.id)
              ? renderReadRow(row, index, rows, {
                  currentAuthorId,
                  onEnterEdit: () => setRowSaved(row.id, false),
                  resolveRowWriter,
                })
              : renderEditRow(row, index, {
                  controlsDisabled,
                  onPendingChange,
                  onSave: () => setRowSaved(row.id, true),
                })}
          </Fragment>
        ))}
        <div
          className={classNames("tracker-entry-list-footer", footerClassName)}
        >
          {rows.length} entries
        </div>
      </section>
    </div>
  );
}

/** Shared read/edit shell for repeated-row tracker documents. */
export function TrackerDocument<Row extends TrackerRow, QuickEntry>(
  params: TrackerDocumentProps<Row, QuickEntry>,
) {
  const {
    currentAuthorId = null,
    disabled = false,
    editingRowId = null,
    editActionId,
    emptyLabel,
    footerClassName,
    isEditing = true,
    listClassName,
    listLabel,
    onAddRow,
    onEnterEdit,
    onToggleEditing,
    ready,
    renderQuickAdd,
    renderReadTable,
    resolveRowWriter,
    rows,
  } = params;
  const controlsDisabled = disabled || !ready;
  const [entryPending, onPendingChange] = useState(false);
  useStructuredDocumentEditAction({
    disabled: controlsDisabled || entryPending,
    editingLabel: "Save",
    id: editActionId,
    isEditing,
    onToggleEditing,
  });

  if (!isEditing) {
    return (
      <div className="tracker-document-fields">
        <section className={classNames("tracker-entry-list", listClassName)}>
          <strong>{listLabel}</strong>
          {onEnterEdit
            ? renderQuickAdd({
                controlsDisabled,
                onAddRow,
                onPendingChange,
              })
            : null}
          {rows.length === 0 && entryPending
            ? null
            : renderReadTable({
                currentAuthorId,
                onEnterEdit: entryPending ? undefined : onEnterEdit,
                resolveRowWriter,
              })}
          <div
            className={classNames("tracker-entry-list-footer", footerClassName)}
          >
            {rows.length} entries
          </div>
        </section>
      </div>
    );
  }

  return (
    <TrackerEditFields
      key={editingRowId ?? "document"}
      {...params}
      controlsDisabled={controlsDisabled}
      editingRowId={editingRowId}
      emptyLabel={emptyLabel}
      entryPending={entryPending}
      listLabel={listLabel}
      onAddRow={onAddRow}
      onPendingChange={onPendingChange}
      renderQuickAdd={renderQuickAdd}
      rows={rows}
    />
  );
}
