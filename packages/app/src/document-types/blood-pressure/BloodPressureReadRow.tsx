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
  BLOOD_PRESSURE_DIASTOLIC_FIELD,
  BLOOD_PRESSURE_MEASURED_AT_FIELD,
  BLOOD_PRESSURE_NOTES_FIELD,
  BLOOD_PRESSURE_PULSE_FIELD,
  BLOOD_PRESSURE_SYSTOLIC_FIELD,
} from "./bloodPressureDocumentDefinition";
import {
  type BloodPressureReadingRow,
  formatMeasuredAt,
  formatMeasurementPair,
  formatPulse,
} from "./bloodPressureReadings";

// Build the per-field attribution rows for the drill-down. Each cell's verified
// writer is resolved from its last-editor peer; null when unknown (attribution
// not synced) so the overlay can omit it.
function toReadingDetailFields(
  reading: BloodPressureReadingRow,
  resolveRowWriter?: RowWriterResolver | undefined,
): RowDetailField[] {
  const fieldWriter = (field: string): string | null =>
    resolveRowWriter?.(reading.fieldEditors[field] ?? null) ?? null;
  return [
    {
      label: "Systolic",
      value: reading.systolic,
      writerUserId: fieldWriter(BLOOD_PRESSURE_SYSTOLIC_FIELD),
    },
    {
      label: "Diastolic",
      value: reading.diastolic,
      writerUserId: fieldWriter(BLOOD_PRESSURE_DIASTOLIC_FIELD),
    },
    {
      label: "Pulse",
      value: reading.pulse,
      writerUserId: fieldWriter(BLOOD_PRESSURE_PULSE_FIELD),
    },
    {
      label: "Measured at",
      value: formatMeasuredAt(reading),
      writerUserId: fieldWriter(BLOOD_PRESSURE_MEASURED_AT_FIELD),
    },
    {
      label: "Notes",
      value: reading.notes,
      writerUserId: fieldWriter(BLOOD_PRESSURE_NOTES_FIELD),
    },
  ];
}

// The kebab actions for a reading. When Edit is available (the viewer can
// write) it opens a small popover with Edit (switch the tracker into edit mode)
// and Attribution (open the per-field attribution overlay), mirroring the
// explorer/identity kebabs. A read-only viewer has only one action, so the kebab
// opens the attribution overlay directly rather than a one-item menu — one
// keystroke, and the trigger stays mounted so the overlay restores focus to it.
function BloodPressureReadingActions(params: {
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
        aria-label={`Reading ${index + 1} attribution`}
        className="blood-pressure-reading-read-actions tracker-read-actions"
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
        aria-label={`Reading ${index + 1} actions`}
        className="blood-pressure-reading-read-actions tracker-read-actions"
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

// A single reading in read mode: the summary cells, a kebab that opens a small
// actions menu (Edit / Attribution), and the row's last-edit attribution line.
export function BloodPressureReadingReadRow(params: {
  currentAuthorId: string | null;
  index: number;
  onEnterEdit?: (() => void) | undefined;
  reading: BloodPressureReadingRow;
  resolveRowWriter?: RowWriterResolver | undefined;
}) {
  const { currentAuthorId, index, onEnterEdit, reading, resolveRowWriter } =
    params;
  const [detailOpen, setDetailOpen] = useState(false);
  const notes = reading.notes.trim();
  // Prefer the server-verified writer for this reading's last edit; fall back to
  // the row's self-attested author when attribution is unavailable.
  const updatedBy =
    resolveRowWriter?.(reading.updatedByPeer) ?? reading.updatedBy;
  const createdBy =
    resolveRowWriter?.(reading.createdByPeer) ?? reading.createdBy;
  const attribution = formatRowAttribution({
    currentAuthorId,
    updatedAt: reading.updatedAt,
    updatedBy,
  });
  const detailFields = toReadingDetailFields(reading, resolveRowWriter);

  return (
    <>
      <div className="blood-pressure-reading-read-row tracker-read-row">
        <span className="blood-pressure-reading-read-cell tracker-read-cell">
          <strong>Reading</strong>
          <span className="blood-pressure-reading-read-value tracker-read-value">
            {formatMeasurementPair(reading)}
          </span>
        </span>
        <span className="blood-pressure-reading-read-cell tracker-read-cell">
          <strong>Pulse</strong>
          <span className="blood-pressure-reading-read-value tracker-read-value">
            {formatPulse(reading)}
          </span>
        </span>
        <span className="blood-pressure-reading-read-cell tracker-read-cell">
          <strong>Measured</strong>
          <span className="blood-pressure-reading-read-value tracker-read-value">
            {formatMeasuredAt(reading)}
          </span>
        </span>
        <span className="blood-pressure-reading-read-index tracker-read-index">
          {index + 1}
        </span>
        <BloodPressureReadingActions
          index={index}
          onEnterEdit={onEnterEdit}
          onOpenAttribution={() => setDetailOpen(true)}
        />
        {notes.length > 0 ? (
          <span
            className="blood-pressure-reading-read-notes tracker-read-notes"
            title={notes}
          >
            {notes}
          </span>
        ) : null}
        {attribution ? (
          <span className="blood-pressure-reading-read-attribution tracker-read-attribution">
            {attribution}
          </span>
        ) : null}
      </div>
      {detailOpen ? (
        <DocumentRowDetailOverlay
          createdAt={reading.createdAt}
          createdBy={createdBy}
          currentAuthorId={currentAuthorId}
          fields={detailFields}
          onClose={() => setDetailOpen(false)}
          showFieldValues={false}
          title={`Reading ${index + 1}`}
          updatedAt={reading.updatedAt}
          updatedBy={updatedBy}
        />
      ) : null}
    </>
  );
}
