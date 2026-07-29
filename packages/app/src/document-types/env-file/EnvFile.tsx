import { useCallback, useId } from "react";
import { MiniAppInput } from "../../components/mini-app/MiniAppLayout";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import {
  type RowWriterResolver,
  useDocumentRowWriters,
} from "../../stores/documents/useDocumentRowWriters";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
  useStructuredDocumentEditAction,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import { useDocumentRowEditing } from "../shared/useDocumentRowEditing";
import {
  usePendingTrackerEntry,
  useSavedTrackerRows,
} from "../shared/useTrackerEntryState";
import {
  EnvFileVariableEditRow,
  type EnvVariableField,
  type UpdateEnvVariable,
} from "./EnvFileEditRow";
import { EnvFileQuickAdd, type EnvFileQuickVariable } from "./EnvFileQuickAdd";
import { EnvFileVariableReadRow } from "./EnvFileVariableReadRow";
import {
  ENV_FILE_DOCUMENT_KIND,
  ENV_FILE_NAME_FIELD,
  ENV_FILE_VARIABLE_KEY_FIELD,
  ENV_FILE_VARIABLE_VALUE_FIELD,
} from "./envFileDocumentDefinition";
import { type EnvVariableRow, toEnvVariableRows } from "./envFileVariables";
import "./EnvFile.css";

function readFileNameField(
  structuredFields: Readonly<Record<string, string>>,
): string {
  const value = structuredFields[ENV_FILE_NAME_FIELD];
  return typeof value === "string" ? value : "";
}

function EnvFileReadFields(params: {
  controlsDisabled: boolean;
  currentAuthorId: string | null;
  entryPending: boolean;
  onAddVariable: (variable: EnvFileQuickVariable) => void;
  onEnterEdit?: (() => void) | undefined;
  onPendingChange: (pending: boolean) => void;
  resolveRowWriter?: RowWriterResolver | undefined;
  variables: ReadonlyArray<EnvVariableRow>;
}) {
  const {
    controlsDisabled,
    currentAuthorId,
    entryPending,
    onAddVariable,
    onEnterEdit,
    onPendingChange,
    resolveRowWriter,
    variables,
  } = params;

  return (
    <div className="env-file-document-fields tracker-document-fields">
      <section className="env-file-variable-list tracker-entry-list">
        <div className="env-file-variable-list-header tracker-entry-list-header">
          <strong>Variables</strong>
        </div>
        {onEnterEdit ? (
          <EnvFileQuickAdd
            controlsDisabled={controlsDisabled}
            onAddVariable={onAddVariable}
            onPendingChange={onPendingChange}
          />
        ) : null}
        {variables.length === 0 && !entryPending ? (
          <div className="env-file-empty-state tracker-empty-state">
            No variables
          </div>
        ) : (
          variables.map((variable, index) => (
            <EnvFileVariableReadRow
              key={variable.id}
              currentAuthorId={currentAuthorId}
              index={index}
              onEnterEdit={entryPending ? undefined : onEnterEdit}
              resolveRowWriter={resolveRowWriter}
              variable={variable}
            />
          ))
        )}
        <div className="env-file-variable-list-footer tracker-entry-list-footer">
          {variables.length} entries
        </div>
      </section>
    </div>
  );
}

function EnvFileEditFields(params: {
  currentAuthorId: string | null;
  controlsDisabled: boolean;
  entryPending: boolean;
  fileName: string;
  fileNameInputId: string;
  onAddVariable: (variable: EnvFileQuickVariable) => void;
  onPendingChange: (pending: boolean) => void;
  onRemoveVariable: (id: string) => void;
  onRenameFile: (value: string) => void;
  onUpdateVariable: UpdateEnvVariable;
  ready: boolean;
  resolveRowWriter?: RowWriterResolver | undefined;
  variables: ReadonlyArray<EnvVariableRow>;
}) {
  const {
    currentAuthorId,
    entryPending,
    controlsDisabled,
    fileName,
    fileNameInputId,
    onAddVariable,
    onPendingChange,
    onRemoveVariable,
    onRenameFile,
    onUpdateVariable,
    ready,
    resolveRowWriter,
    variables,
  } = params;

  return (
    <div className="env-file-document-fields tracker-document-fields">
      <StructuredDocumentFields>
        <StructuredDocumentField inputId={fileNameInputId} label="File Name">
          <MiniAppInput
            id={fileNameInputId}
            aria-label=".env file name"
            value={fileName}
            onChange={(event) => onRenameFile(event.target.value)}
            placeholder={ready ? ".env" : "Loading..."}
            disabled={controlsDisabled}
            autoComplete="off"
          />
        </StructuredDocumentField>
      </StructuredDocumentFields>
      <section className="env-file-variable-list tracker-entry-list">
        <div className="env-file-variable-list-header tracker-entry-list-header">
          <strong>Variables</strong>
        </div>
        <EnvFileQuickAdd
          controlsDisabled={controlsDisabled}
          onAddVariable={onAddVariable}
          onPendingChange={onPendingChange}
        />
        {variables.length === 0 && !entryPending ? (
          <div className="env-file-empty-state tracker-empty-state">
            No variables
          </div>
        ) : (
          <EnvFileEditRows
            controlsDisabled={controlsDisabled}
            currentAuthorId={currentAuthorId}
            onRemoveVariable={onRemoveVariable}
            onUpdateVariable={onUpdateVariable}
            resolveRowWriter={resolveRowWriter}
            variables={variables}
          />
        )}
        <div className="env-file-variable-list-footer tracker-entry-list-footer">
          {variables.length} entries
        </div>
      </section>
    </div>
  );
}

function EnvFileEditRows(params: {
  controlsDisabled: boolean;
  currentAuthorId: string | null;
  onRemoveVariable: (id: string) => void;
  onUpdateVariable: UpdateEnvVariable;
  resolveRowWriter?: RowWriterResolver | undefined;
  variables: ReadonlyArray<EnvVariableRow>;
}) {
  const { savedRowIds, setRowSaved } = useSavedTrackerRows();

  return params.variables.map((variable, index) =>
    savedRowIds.has(variable.id) ? (
      <EnvFileVariableReadRow
        key={variable.id}
        currentAuthorId={params.currentAuthorId}
        index={index}
        onEnterEdit={() => setRowSaved(variable.id, false)}
        resolveRowWriter={params.resolveRowWriter}
        variable={variable}
      />
    ) : (
      <EnvFileVariableEditRow
        key={variable.id}
        controlsDisabled={params.controlsDisabled}
        index={index}
        onRemoveVariable={params.onRemoveVariable}
        onSaveVariable={(id) => setRowSaved(id, true)}
        onUpdateVariable={params.onUpdateVariable}
        variable={variable}
      />
    ),
  );
}

export function EnvFileFields(params: {
  currentAuthorId?: string | null;
  disabled?: boolean | undefined;
  fileName: string;
  fileNameInputId: string;
  isEditing?: boolean | undefined;
  onAddVariable: (variable: EnvFileQuickVariable) => void;
  onEnterEdit?: (() => void) | undefined;
  onRemoveVariable: (id: string) => void;
  onRenameFile: (value: string) => void;
  onToggleEditing: () => void;
  onUpdateVariable: (
    id: string,
    field: EnvVariableField,
    value: string,
  ) => void;
  ready: boolean;
  resolveRowWriter?: RowWriterResolver | undefined;
  variables: ReadonlyArray<EnvVariableRow>;
}) {
  const {
    currentAuthorId = null,
    disabled = false,
    fileName,
    fileNameInputId,
    isEditing = true,
    onAddVariable,
    onEnterEdit,
    onRemoveVariable,
    onRenameFile,
    onToggleEditing,
    onUpdateVariable,
    ready,
    resolveRowWriter,
    variables,
  } = params;
  const controlsDisabled = disabled || !ready;
  const {
    entryPending: newVariablePending,
    onPendingChange,
    toggleEditing,
  } = usePendingTrackerEntry(onToggleEditing);
  useStructuredDocumentEditAction({
    disabled: controlsDisabled || newVariablePending,
    editingLabel: "Save",
    id: "env-file-toggle-edit",
    isEditing,
    onToggleEditing: toggleEditing,
  });

  if (!isEditing) {
    return (
      <EnvFileReadFields
        controlsDisabled={controlsDisabled}
        currentAuthorId={currentAuthorId}
        entryPending={newVariablePending}
        onAddVariable={onAddVariable}
        onEnterEdit={onEnterEdit}
        onPendingChange={onPendingChange}
        resolveRowWriter={resolveRowWriter}
        variables={variables}
      />
    );
  }

  return (
    <EnvFileEditFields
      currentAuthorId={currentAuthorId}
      controlsDisabled={controlsDisabled}
      entryPending={newVariablePending}
      fileName={fileName}
      fileNameInputId={fileNameInputId}
      onAddVariable={onAddVariable}
      onPendingChange={onPendingChange}
      onRemoveVariable={onRemoveVariable}
      onRenameFile={onRenameFile}
      onUpdateVariable={onUpdateVariable}
      ready={ready}
      resolveRowWriter={resolveRowWriter}
      variables={variables}
    />
  );
}

export function EnvFile(params: { initialEditing?: boolean | undefined }) {
  const {
    addRow,
    canWrite,
    currentAuthorId,
    ready,
    removeRow,
    rows,
    setStructuredFields,
    structuredFields,
    updateRowFields,
  } = useDocument();
  const fileNameInputId = useId();
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
  const resolveRowWriter = useDocumentRowWriters(rows.length > 0);

  const fileName = readFileNameField(structuredFields);
  const variables = toEnvVariableRows(rows, readCell);

  function handleUpdateVariable(
    id: string,
    field: EnvVariableField,
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
        <EnvFileFields
          currentAuthorId={currentAuthorId}
          disabled={!ready || !canWrite}
          fileName={fileName}
          fileNameInputId={fileNameInputId}
          isEditing={isEditing && canWrite}
          resolveRowWriter={resolveRowWriter}
          onEnterEdit={canWrite ? () => setIsEditing(true) : undefined}
          onAddVariable={(variable) => {
            if (canWrite) {
              void addRow({
                [ENV_FILE_VARIABLE_KEY_FIELD]: variable.key,
                [ENV_FILE_VARIABLE_VALUE_FIELD]: variable.value,
              });
            }
          }}
          onRemoveVariable={(id) => {
            if (canWrite) {
              void removeRow(id);
            }
            clearRow(id);
          }}
          onToggleEditing={toggleEditing}
          onRenameFile={(value) => {
            if (canWrite) {
              void setStructuredFields(ENV_FILE_DOCUMENT_KIND, {
                fileName: value,
              });
            }
          }}
          onUpdateVariable={handleUpdateVariable}
          ready={ready}
          variables={variables}
        />
      }
    />
  );
}
