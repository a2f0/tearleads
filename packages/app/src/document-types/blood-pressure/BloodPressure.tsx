import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useCallback, useId, useMemo } from "react";
import { MiniAppButton } from "../../components/mini-app/MiniAppLayout";
import { useWindowTitleBarAction } from "../../components/window/WindowMenuContext";
import {
  useDocument,
  useDocumentReadOnly,
} from "../../stores/documents/DocumentsProvider";
import {
  type RowWriterResolver,
  useDocumentRowWriters,
} from "../../stores/documents/useDocumentRowWriters";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import { useDocumentRowEditing } from "../shared/useDocumentRowEditing";
import {
  type BloodPressureField,
  BloodPressureReadingEditRow,
  type UpdateReading,
} from "./BloodPressureEditRow";
import { BloodPressureReadingReadRow } from "./BloodPressureReadRow";
import {
  BLOOD_PRESSURE_DIASTOLIC_FIELD,
  BLOOD_PRESSURE_DOCUMENT_KIND,
  BLOOD_PRESSURE_MEASURED_AT_FIELD,
  BLOOD_PRESSURE_NOTES_FIELD,
  BLOOD_PRESSURE_PULSE_FIELD,
  BLOOD_PRESSURE_SYSTOLIC_FIELD,
} from "./bloodPressureDocumentDefinition";
import {
  type BloodPressureReadingRow,
  readTrackerNameField,
  toBloodPressureReadingRows,
} from "./bloodPressureReadings";
import "./BloodPressure.css";

const BLOOD_PRESSURE_DONE_ACTION = "Done";
const BLOOD_PRESSURE_EDIT_ACTION = "Edit";

function BloodPressureReadFields(params: {
  currentAuthorId: string | null;
  onEnterEdit?: (() => void) | undefined;
  readings: ReadonlyArray<BloodPressureReadingRow>;
  resolveRowWriter?: RowWriterResolver | undefined;
  trackerName: string;
}) {
  const {
    currentAuthorId,
    onEnterEdit,
    readings,
    resolveRowWriter,
    trackerName,
  } = params;

  return (
    <div className="blood-pressure-document-fields">
      <StructuredDocumentReadFields
        fields={[
          {
            label: "Tracker Name",
            value: trackerName,
            // Fall back to the document type's name rather than the generic
            // "None" placeholder when the tracker was never named. Only override
            // the empty case — leaving displayValue undefined for a real name
            // keeps its hover-title tooltip when the name is truncated.
            displayValue:
              trackerName.trim().length > 0
                ? undefined
                : "Blood Pressure Tracker",
          },
        ]}
      />
      <section className="blood-pressure-reading-list">
        <div className="blood-pressure-reading-list-header">
          <div className="blood-pressure-reading-list-title">
            <strong>Readings</strong>
            <span>{readings.length} entries</span>
          </div>
        </div>
        {readings.length === 0 ? (
          <div className="blood-pressure-empty-state">No readings</div>
        ) : (
          readings.map((reading, index) => (
            <BloodPressureReadingReadRow
              key={reading.id}
              currentAuthorId={currentAuthorId}
              index={index}
              onEnterEdit={onEnterEdit}
              reading={reading}
              resolveRowWriter={resolveRowWriter}
            />
          ))
        )}
      </section>
    </div>
  );
}

function BloodPressureEditFields(params: {
  controlsDisabled: boolean;
  onAddReading: () => void;
  onRemoveReading: (id: string) => void;
  onRenameTracker: (value: string) => void;
  onUpdateReading: UpdateReading;
  readings: ReadonlyArray<BloodPressureReadingRow>;
  ready: boolean;
  trackerName: string;
  trackerNameInputId: string;
}) {
  const {
    controlsDisabled,
    onAddReading,
    onRemoveReading,
    onRenameTracker,
    onUpdateReading,
    readings,
    ready,
    trackerName,
    trackerNameInputId,
  } = params;

  return (
    <div className="blood-pressure-document-fields">
      <StructuredDocumentFields>
        <StructuredDocumentField
          inputId={trackerNameInputId}
          label="Tracker Name"
        >
          <input
            id={trackerNameInputId}
            aria-label="Blood pressure tracker name"
            value={trackerName}
            onChange={(event) => onRenameTracker(event.target.value)}
            placeholder={ready ? "Morning readings" : "Loading..."}
            disabled={controlsDisabled}
            autoComplete="off"
          />
        </StructuredDocumentField>
      </StructuredDocumentFields>
      <section className="blood-pressure-reading-list">
        <div className="blood-pressure-reading-list-header">
          <div className="blood-pressure-reading-list-title">
            <strong>Readings</strong>
            <span>{readings.length} entries</span>
          </div>
          <MiniAppButton
            className="blood-pressure-add-button"
            withIcon
            disabled={controlsDisabled}
            onClick={onAddReading}
          >
            <PlusIcon aria-hidden size={14} />
            Add Reading
          </MiniAppButton>
        </div>
        {readings.length === 0 ? (
          <div className="blood-pressure-empty-state">No readings</div>
        ) : (
          readings.map((reading, index) => (
            <BloodPressureReadingEditRow
              key={reading.id}
              controlsDisabled={controlsDisabled}
              index={index}
              onRemoveReading={onRemoveReading}
              onUpdateReading={onUpdateReading}
              reading={reading}
            />
          ))
        )}
      </section>
    </div>
  );
}

export function BloodPressureFields(params: {
  currentAuthorId?: string | null;
  disabled?: boolean | undefined;
  isEditing?: boolean | undefined;
  onAddReading: () => void;
  onEnterEdit?: (() => void) | undefined;
  onRemoveReading: (id: string) => void;
  onRenameTracker: (value: string) => void;
  onToggleEditing: () => void;
  onUpdateReading: UpdateReading;
  readings: ReadonlyArray<BloodPressureReadingRow>;
  ready: boolean;
  resolveRowWriter?: RowWriterResolver | undefined;
  trackerName: string;
  trackerNameInputId: string;
}) {
  const {
    currentAuthorId = null,
    disabled = false,
    isEditing = true,
    onAddReading,
    onEnterEdit,
    onRemoveReading,
    onRenameTracker,
    onToggleEditing,
    onUpdateReading,
    readings,
    ready,
    resolveRowWriter,
    trackerName,
    trackerNameInputId,
  } = params;
  const controlsDisabled = disabled || !ready;
  // The edit toggle is a pane-header toolbar action (the pencil), not a body
  // button — mirroring the Contact document. A host-forced read-only tracker
  // (e.g. in the Trash) drops the affordance entirely rather than disabling it.
  const readOnly = useDocumentReadOnly();
  const editAction = useMemo(
    () => ({
      disabled: controlsDisabled,
      icon: isEditing ? (
        <CheckIcon aria-hidden size={18} />
      ) : (
        <PencilSimpleIcon aria-hidden size={18} />
      ),
      id: "blood-pressure-toggle-edit",
      label: isEditing
        ? BLOOD_PRESSURE_DONE_ACTION
        : BLOOD_PRESSURE_EDIT_ACTION,
      onClick: onToggleEditing,
      priority: 100,
    }),
    [controlsDisabled, isEditing, onToggleEditing],
  );

  useWindowTitleBarAction(readOnly ? null : editAction);

  if (!isEditing) {
    return (
      <BloodPressureReadFields
        currentAuthorId={currentAuthorId}
        onEnterEdit={onEnterEdit}
        readings={readings}
        resolveRowWriter={resolveRowWriter}
        trackerName={trackerName}
      />
    );
  }

  return (
    <BloodPressureEditFields
      controlsDisabled={controlsDisabled}
      onAddReading={onAddReading}
      onRemoveReading={onRemoveReading}
      onRenameTracker={onRenameTracker}
      onUpdateReading={onUpdateReading}
      readings={readings}
      ready={ready}
      trackerName={trackerName}
      trackerNameInputId={trackerNameInputId}
    />
  );
}

export function BloodPressure(params: {
  initialEditing?: boolean | undefined;
}) {
  const {
    addRow,
    canWrite,
    currentAuthorId,
    ready,
    removeRow,
    rows,
    setStructuredFields,
    structuredFields,
    syncing,
    updateRowFields,
  } = useDocument();
  const trackerNameInputId = useId();
  const [isEditing, setIsEditing] = useStructuredDocumentEditing(
    canWrite,
    params.initialEditing,
  );
  // Kept reference-stable so the toolbar action it feeds does not re-register
  // on every render.
  const toggleEditing = useCallback(
    () => setIsEditing((editing) => !editing),
    [setIsEditing],
  );
  const { clearRow, readCell, stageCell } = useDocumentRowEditing(rows);
  // Only resolve verified writers for the read view (attribution is not shown
  // while editing) of a non-empty tracker.
  const resolveRowWriter = useDocumentRowWriters(
    !(isEditing && canWrite) && rows.length > 0,
  );

  const trackerName = readTrackerNameField(structuredFields);
  const readings = toBloodPressureReadingRows(rows, readCell);

  function handleUpdateReading(
    id: string,
    field: BloodPressureField,
    value: string,
  ) {
    stageCell(id, field, value);
    if (canWrite) {
      void updateRowFields(id, { [field]: value });
    }
  }

  return (
    <StructuredDocument
      fields={
        <BloodPressureFields
          currentAuthorId={currentAuthorId}
          disabled={!ready || !canWrite}
          isEditing={isEditing && canWrite}
          resolveRowWriter={resolveRowWriter}
          // The read-row "Edit" action switches the whole tracker into edit
          // mode; only offer it when the viewer can actually write.
          onEnterEdit={canWrite ? () => setIsEditing(true) : undefined}
          onAddReading={() => {
            if (canWrite) {
              void addRow({
                [BLOOD_PRESSURE_SYSTOLIC_FIELD]: "",
                [BLOOD_PRESSURE_DIASTOLIC_FIELD]: "",
                [BLOOD_PRESSURE_PULSE_FIELD]: "",
                [BLOOD_PRESSURE_MEASURED_AT_FIELD]: "",
                [BLOOD_PRESSURE_NOTES_FIELD]: "",
              });
            }
          }}
          onRemoveReading={(id) => {
            if (canWrite) {
              void removeRow(id);
            }
            clearRow(id);
          }}
          onRenameTracker={(value) => {
            if (canWrite) {
              void setStructuredFields(BLOOD_PRESSURE_DOCUMENT_KIND, {
                trackerName: value,
              });
            }
          }}
          onToggleEditing={toggleEditing}
          onUpdateReading={handleUpdateReading}
          readings={readings}
          ready={ready}
          trackerName={trackerName}
          trackerNameInputId={trackerNameInputId}
        />
      }
      ready={ready}
      syncing={syncing}
      title="Blood Pressure Tracker"
    />
  );
}
