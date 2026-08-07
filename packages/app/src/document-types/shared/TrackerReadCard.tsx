import { type ReactNode, useState } from "react";
import { classNames } from "../../components/shared/classNames";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import {
  DocumentRowDetailOverlay,
  type RowDetailField,
} from "./DocumentRowDetail";
import { formatRowAttribution } from "./rowAttribution";
import { TrackerReadActions } from "./TrackerReadActions";
import { resolveTrackerRowWriter, type TrackerRow } from "./trackerRows";

interface TrackerReadCardCell {
  content?: ReactNode;
  label: string;
  text?: string;
  title?: string | undefined;
}

export function TrackerReadCard<Row extends TrackerRow>(params: {
  actionsAriaLabel: string;
  cells: ReadonlyArray<TrackerReadCardCell>;
  className?: string | undefined;
  currentAuthorId: string | null;
  detailFields: ReadonlyArray<RowDetailField>;
  detailLabel: string;
  detailTitle: string;
  directAriaLabel: string;
  index: number;
  notes?: string | undefined;
  onEnterEdit?: (() => void) | undefined;
  resolveRowWriter?: RowWriterResolver | undefined;
  row: Row;
  showFieldValues?: boolean | undefined;
}) {
  const {
    actionsAriaLabel,
    cells,
    className,
    currentAuthorId,
    detailFields,
    detailLabel,
    detailTitle,
    directAriaLabel,
    index,
    notes,
    onEnterEdit,
    resolveRowWriter,
    row,
    showFieldValues,
  } = params;
  const [detailOpen, setDetailOpen] = useState(false);
  const updatedBy = resolveTrackerRowWriter(
    row.updatedByPeer,
    row.updatedBy,
    resolveRowWriter,
  );
  const attribution = formatRowAttribution({
    currentAuthorId,
    updatedAt: row.updatedAt,
    updatedBy,
  });
  const trimmedNotes = notes?.trim() ?? "";

  return (
    <>
      <div className={classNames("tracker-read-row", className)}>
        {cells.map((cell) => (
          <span className="tracker-read-cell" key={cell.label}>
            <strong>{cell.label}</strong>
            {cell.content ?? (
              <span className="tracker-read-value" title={cell.title}>
                {cell.text}
              </span>
            )}
          </span>
        ))}
        <span className="tracker-read-index">{index + 1}</span>
        <TrackerReadActions
          actionsAriaLabel={actionsAriaLabel}
          detailLabel={detailLabel}
          detailsOpen={detailOpen}
          directAriaLabel={directAriaLabel}
          onEnterEdit={onEnterEdit}
          onOpenDetails={() => setDetailOpen(true)}
        />
        {trimmedNotes.length > 0 ? (
          <span className="tracker-read-notes" title={trimmedNotes}>
            {trimmedNotes}
          </span>
        ) : null}
        {attribution ? (
          <span className="tracker-read-attribution">{attribution}</span>
        ) : null}
      </div>
      {detailOpen ? (
        <DocumentRowDetailOverlay
          createdAt={row.createdAt}
          createdBy={resolveTrackerRowWriter(
            row.createdByPeer,
            row.createdBy,
            resolveRowWriter,
          )}
          currentAuthorId={currentAuthorId}
          fields={detailFields}
          onClose={() => setDetailOpen(false)}
          title={detailTitle}
          updatedAt={row.updatedAt}
          updatedBy={updatedBy}
          {...(showFieldValues === undefined ? {} : { showFieldValues })}
        />
      ) : null}
    </>
  );
}
