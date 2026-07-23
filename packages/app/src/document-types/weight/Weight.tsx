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
import { useWeightEntryWriters } from "./useWeightEntryWriters";
import { type UpdateEntry, WeightEntryEditRow } from "./WeightEditRow";
import { WeightEntryReadRow } from "./WeightReadRow";
import {
  toWeightUnit,
  WEIGHT_DOCUMENT_KIND,
  WEIGHT_MEASURED_AT_FIELD,
  WEIGHT_MEASUREMENT_FIELD,
  WEIGHT_NOTES_FIELD,
  WEIGHT_TRACKER_NAME_FIELD,
  WEIGHT_UNITS,
  type WeightUnit,
} from "./weightDocumentDefinition";
import {
  readTrackerNameField,
  readUnitField,
  toWeightEntryRows,
  type WeightEntryRow,
} from "./weightEntries";
import "./Weight.css";

const WEIGHT_DONE_ACTION = "Done";
const WEIGHT_EDIT_ACTION = "Edit";

function WeightReadFields(params: {
  currentAuthorId: string | null;
  entries: ReadonlyArray<WeightEntryRow>;
  onEnterEdit?: (() => void) | undefined;
  resolveRowWriter?: RowWriterResolver | undefined;
  trackerName: string;
  unit: WeightUnit;
}) {
  const {
    currentAuthorId,
    entries,
    onEnterEdit,
    resolveRowWriter,
    trackerName,
    unit,
  } = params;

  return (
    <div className="weight-document-fields">
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
              trackerName.trim().length > 0 ? undefined : "Weight Tracker",
          },
          { label: "Unit", value: unit },
        ]}
      />
      <section className="weight-entry-list">
        <div className="weight-entry-list-header">
          <div className="weight-entry-list-title">
            <strong>Entries</strong>
            <span>{entries.length} entries</span>
          </div>
        </div>
        {entries.length === 0 ? (
          <div className="weight-empty-state">No entries</div>
        ) : (
          entries.map((entry, index) => (
            <WeightEntryReadRow
              key={entry.id}
              currentAuthorId={currentAuthorId}
              entry={entry}
              index={index}
              onEnterEdit={onEnterEdit}
              previous={entries[index - 1]}
              resolveRowWriter={resolveRowWriter}
              unit={unit}
            />
          ))
        )}
      </section>
    </div>
  );
}

function WeightEditFields(params: {
  controlsDisabled: boolean;
  entries: ReadonlyArray<WeightEntryRow>;
  onAddEntry: () => void;
  onChangeUnit: (unit: WeightUnit) => void;
  onRemoveEntry: (id: string) => void;
  onRenameTracker: (value: string) => void;
  onUpdateEntry: UpdateEntry;
  ready: boolean;
  trackerName: string;
  trackerNameInputId: string;
  unit: WeightUnit;
  unitInputId: string;
}) {
  const {
    controlsDisabled,
    entries,
    onAddEntry,
    onChangeUnit,
    onRemoveEntry,
    onRenameTracker,
    onUpdateEntry,
    ready,
    trackerName,
    trackerNameInputId,
    unit,
    unitInputId,
  } = params;

  return (
    <div className="weight-document-fields">
      <StructuredDocumentFields>
        <StructuredDocumentField
          inputId={trackerNameInputId}
          label="Tracker Name"
        >
          <input
            id={trackerNameInputId}
            aria-label="Weight tracker name"
            value={trackerName}
            onChange={(event) => onRenameTracker(event.target.value)}
            placeholder={ready ? "Morning weigh-ins" : "Loading..."}
            disabled={controlsDisabled}
            autoComplete="off"
          />
        </StructuredDocumentField>
        <StructuredDocumentField inputId={unitInputId} label="Unit">
          <select
            id={unitInputId}
            aria-label="Weight unit"
            value={unit}
            onChange={(event) => onChangeUnit(toWeightUnit(event.target.value))}
            disabled={controlsDisabled}
          >
            {WEIGHT_UNITS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </StructuredDocumentField>
      </StructuredDocumentFields>
      <section className="weight-entry-list">
        <div className="weight-entry-list-header">
          <div className="weight-entry-list-title">
            <strong>Entries</strong>
            <span>{entries.length} entries</span>
          </div>
          <MiniAppButton
            className="weight-add-button"
            withIcon
            disabled={controlsDisabled}
            onClick={onAddEntry}
          >
            <PlusIcon aria-hidden size={14} />
            Add Entry
          </MiniAppButton>
        </div>
        {entries.length === 0 ? (
          <div className="weight-empty-state">No entries</div>
        ) : (
          entries.map((entry, index) => (
            <WeightEntryEditRow
              key={entry.id}
              controlsDisabled={controlsDisabled}
              entry={entry}
              index={index}
              onRemoveEntry={onRemoveEntry}
              onUpdateEntry={onUpdateEntry}
              unit={unit}
            />
          ))
        )}
      </section>
    </div>
  );
}

export function WeightFields(params: {
  currentAuthorId?: string | null;
  disabled?: boolean | undefined;
  entries: ReadonlyArray<WeightEntryRow>;
  isEditing?: boolean | undefined;
  onAddEntry: () => void;
  onChangeUnit: (unit: WeightUnit) => void;
  onEnterEdit?: (() => void) | undefined;
  onRemoveEntry: (id: string) => void;
  onRenameTracker: (value: string) => void;
  onToggleEditing: () => void;
  onUpdateEntry: UpdateEntry;
  ready: boolean;
  resolveRowWriter?: RowWriterResolver | undefined;
  trackerName: string;
  trackerNameInputId: string;
  unit: WeightUnit;
  unitInputId: string;
}) {
  const {
    currentAuthorId = null,
    disabled = false,
    entries,
    isEditing = true,
    onAddEntry,
    onChangeUnit,
    onEnterEdit,
    onRemoveEntry,
    onRenameTracker,
    onToggleEditing,
    onUpdateEntry,
    ready,
    resolveRowWriter,
    trackerName,
    trackerNameInputId,
    unit,
    unitInputId,
  } = params;
  const controlsDisabled = disabled || !ready;
  // The edit toggle is a pane-header toolbar action (the pencil), not a body
  // button — mirroring the Contact and Blood Pressure documents. A host-forced
  // read-only tracker (e.g. in the Trash) drops the affordance entirely rather
  // than showing it disabled.
  const readOnly = useDocumentReadOnly();
  const editAction = useMemo(
    () => ({
      disabled: controlsDisabled,
      icon: isEditing ? (
        <CheckIcon aria-hidden size={18} />
      ) : (
        <PencilSimpleIcon aria-hidden size={18} />
      ),
      id: "weight-toggle-edit",
      label: isEditing ? WEIGHT_DONE_ACTION : WEIGHT_EDIT_ACTION,
      onClick: onToggleEditing,
      priority: 100,
    }),
    [controlsDisabled, isEditing, onToggleEditing],
  );

  useWindowTitleBarAction(readOnly ? null : editAction);

  if (!isEditing) {
    return (
      <WeightReadFields
        currentAuthorId={currentAuthorId}
        entries={entries}
        onEnterEdit={onEnterEdit}
        resolveRowWriter={resolveRowWriter}
        trackerName={trackerName}
        unit={unit}
      />
    );
  }

  return (
    <WeightEditFields
      controlsDisabled={controlsDisabled}
      entries={entries}
      onAddEntry={onAddEntry}
      onChangeUnit={onChangeUnit}
      onRemoveEntry={onRemoveEntry}
      onRenameTracker={onRenameTracker}
      onUpdateEntry={onUpdateEntry}
      ready={ready}
      trackerName={trackerName}
      trackerNameInputId={trackerNameInputId}
      unit={unit}
      unitInputId={unitInputId}
    />
  );
}

export function Weight(params: { initialEditing?: boolean | undefined }) {
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
  const unitInputId = useId();
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
  const unit = readUnitField(structuredFields);
  const entries = toWeightEntryRows(rows, readCell);

  const { changeUnit, updateEntry } = useWeightEntryWriters({
    canWrite,
    entries,
    setStructuredFields,
    stageCell,
    unit,
    updateRowFields,
  });

  return (
    <StructuredDocument
      fields={
        <WeightFields
          currentAuthorId={currentAuthorId}
          disabled={!ready || !canWrite}
          entries={entries}
          isEditing={isEditing && canWrite}
          resolveRowWriter={resolveRowWriter}
          // The read-row "Edit" action switches the whole tracker into edit
          // mode; only offer it when the viewer can actually write.
          onEnterEdit={canWrite ? () => setIsEditing(true) : undefined}
          onAddEntry={() => {
            if (canWrite) {
              void addRow({
                [WEIGHT_MEASUREMENT_FIELD]: "",
                [WEIGHT_MEASURED_AT_FIELD]: "",
                [WEIGHT_NOTES_FIELD]: "",
              });
            }
          }}
          onChangeUnit={changeUnit}
          onRemoveEntry={(id) => {
            if (canWrite) {
              void removeRow(id);
            }
            clearRow(id);
          }}
          onRenameTracker={(value) => {
            if (canWrite) {
              void setStructuredFields(WEIGHT_DOCUMENT_KIND, {
                [WEIGHT_TRACKER_NAME_FIELD]: value,
              });
            }
          }}
          onToggleEditing={toggleEditing}
          onUpdateEntry={updateEntry}
          ready={ready}
          trackerName={trackerName}
          trackerNameInputId={trackerNameInputId}
          unit={unit}
          unitInputId={unitInputId}
        />
      }
      ready={ready}
      syncing={syncing}
      title="Weight Tracker"
    />
  );
}
