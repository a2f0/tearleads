import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { type MouseEvent, useRef, useState } from "react";
import { MiniAppRowActionsButton } from "../../components/mini-app/MiniAppTable";
import { Menu, type MenuPosition } from "../../components/shared/Menu";
import { MenuItem } from "../../components/shared/MenuItem";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import {
  DocumentRowDetailOverlay,
  type RowDetailField,
} from "../shared/DocumentRowDetail";
import { formatRowAttribution } from "../shared/rowAttribution";
import {
  WEIGHT_MEASURED_AT_FIELD,
  WEIGHT_MEASUREMENT_FIELD,
  WEIGHT_NOTES_FIELD,
} from "./weightDocumentDefinition";
import {
  formatMeasuredAt,
  formatWeight,
  formatWeightChange,
  type WeightEntryRow,
} from "./weightEntries";

// Build the per-field attribution rows for the drill-down. Each cell's verified
// writer is resolved from its last-editor peer; null when unknown (attribution
// not synced) so the overlay can omit it.
function toEntryDetailFields(
  entry: WeightEntryRow,
  resolveRowWriter?: RowWriterResolver | undefined,
): RowDetailField[] {
  const fieldWriter = (field: string): string | null =>
    resolveRowWriter?.(entry.fieldEditors[field] ?? null) ?? null;
  return [
    {
      label: "Weight",
      value: formatWeight(entry),
      writerUserId: fieldWriter(WEIGHT_MEASUREMENT_FIELD),
    },
    {
      label: "Measured at",
      value: formatMeasuredAt(entry),
      writerUserId: fieldWriter(WEIGHT_MEASURED_AT_FIELD),
    },
    {
      label: "Notes",
      value: entry.notes,
      writerUserId: fieldWriter(WEIGHT_NOTES_FIELD),
    },
  ];
}

// The kebab actions for an entry. When Edit is available (the viewer can write)
// it opens a small popover with Edit (switch the tracker into edit mode) and
// Attribution (open the per-field attribution overlay), mirroring the
// explorer/identity kebabs. A read-only viewer has only one action, so the kebab
// opens the attribution overlay directly rather than a one-item menu — one
// keystroke, and the trigger stays mounted so the overlay restores focus to it.
function WeightEntryActions(params: {
  index: number;
  onEnterEdit?: (() => void) | undefined;
  onOpenAttribution: () => void;
}) {
  const { index, onEnterEdit, onOpenAttribution } = params;
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);

  if (!onEnterEdit) {
    return (
      <MiniAppRowActionsButton
        aria-haspopup="dialog"
        aria-label={`Entry ${index + 1} attribution`}
        className="weight-entry-read-actions tracker-read-actions"
        onClick={onOpenAttribution}
      />
    );
  }

  const toggleMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (menuPosition !== null) {
      setMenuPosition(null);
      return;
    }
    // Anchor to the button's box (not the pointer) so keyboard activation, which
    // reports 0,0 client coordinates, still opens the menu under the trigger.
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.left, y: rect.bottom });
  };
  const closeMenu = () => setMenuPosition(null);

  return (
    <>
      <MiniAppRowActionsButton
        ref={actionsButtonRef}
        aria-expanded={menuPosition !== null}
        aria-label={`Entry ${index + 1} actions`}
        className="weight-entry-read-actions tracker-read-actions"
        onClick={toggleMenu}
        // Keep the trigger's mousedown from reaching the Menu's outside-click
        // handler so re-clicking the trigger can toggle the menu shut.
        onMouseDown={(event) => event.stopPropagation()}
      />
      {menuPosition ? (
        <Menu direction="down" onClose={closeMenu} position={menuPosition}>
          <MenuItem
            icon={PencilSimpleIcon}
            label="Edit"
            onClick={() => {
              closeMenu();
              onEnterEdit();
            }}
          />
          <MenuItem
            icon={InfoIcon}
            label="Attribution"
            onClick={() => {
              // Return focus to the trigger before the overlay mounts so the
              // detail's focus-restore lands back on the kebab on close.
              actionsButtonRef.current?.focus();
              closeMenu();
              onOpenAttribution();
            }}
          />
        </Menu>
      ) : null}
    </>
  );
}

// A single entry in read mode: the weight and how it moved since the previous
// entry, a kebab that opens a small actions menu (Edit / Attribution), and the
// row's last-edit attribution line.
export function WeightEntryReadRow(params: {
  currentAuthorId: string | null;
  entry: WeightEntryRow;
  index: number;
  onEnterEdit?: (() => void) | undefined;
  previous: WeightEntryRow | undefined;
  resolveRowWriter?: RowWriterResolver | undefined;
}) {
  const {
    currentAuthorId,
    entry,
    index,
    onEnterEdit,
    previous,
    resolveRowWriter,
  } = params;
  const [detailOpen, setDetailOpen] = useState(false);
  const notes = entry.notes.trim();
  // Prefer the server-verified writer for this entry's last edit; fall back to
  // the row's self-attested author when attribution is unavailable.
  const updatedBy = resolveRowWriter?.(entry.updatedByPeer) ?? entry.updatedBy;
  const createdBy = resolveRowWriter?.(entry.createdByPeer) ?? entry.createdBy;
  const attribution = formatRowAttribution({
    currentAuthorId,
    updatedAt: entry.updatedAt,
    updatedBy,
  });
  const change = formatWeightChange(entry, previous);
  const detailFields = toEntryDetailFields(entry, resolveRowWriter);

  return (
    <>
      <div className="weight-entry-read-row tracker-read-row">
        <span className="weight-entry-read-cell tracker-read-cell">
          <strong>Weight</strong>
          <span className="weight-entry-read-value tracker-read-value">
            {formatWeight(entry)}
          </span>
        </span>
        <span className="weight-entry-read-cell tracker-read-cell">
          <strong>Change</strong>
          <span className="weight-entry-read-value tracker-read-value">
            {change ?? "—"}
          </span>
        </span>
        <span className="weight-entry-read-cell tracker-read-cell">
          <strong>Measured</strong>
          <span className="weight-entry-read-value tracker-read-value">
            {formatMeasuredAt(entry)}
          </span>
        </span>
        <span className="weight-entry-read-index tracker-read-index">
          {index + 1}
        </span>
        <WeightEntryActions
          index={index}
          onEnterEdit={onEnterEdit}
          onOpenAttribution={() => setDetailOpen(true)}
        />
        {notes.length > 0 ? (
          <span
            className="weight-entry-read-notes tracker-read-notes"
            title={notes}
          >
            {notes}
          </span>
        ) : null}
        {attribution ? (
          <span className="weight-entry-read-attribution tracker-read-attribution">
            {attribution}
          </span>
        ) : null}
      </div>
      {detailOpen ? (
        <DocumentRowDetailOverlay
          createdAt={entry.createdAt}
          createdBy={createdBy}
          currentAuthorId={currentAuthorId}
          fields={detailFields}
          onClose={() => setDetailOpen(false)}
          showFieldValues={false}
          title={`Entry ${index + 1}`}
          updatedAt={entry.updatedAt}
          updatedBy={updatedBy}
        />
      ) : null}
    </>
  );
}
