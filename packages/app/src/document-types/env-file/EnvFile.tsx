import { useId, useState } from "react";
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
} from "../shared/StructuredDocument";
import { useDocumentRowEditing } from "../shared/useDocumentRowEditing";
import {
  type AddTrackerRow,
  useSavedTrackerRows,
} from "../shared/useSavedTrackerRows";
import { useTargetedTrackerEditing } from "../shared/useTargetedTrackerEditing";
import {
  EnvFileVariableEditRow,
  type EnvVariableField,
  type UpdateEnvVariable,
} from "./EnvFileEditRow";
import { EnvFileQuickAdd, type EnvFileQuickVariable } from "./EnvFileQuickAdd";
import { EnvFileReadTable } from "./EnvFileReadTable";
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
  onAddVariable: AddTrackerRow<EnvFileQuickVariable>;
  onEnterEdit?: ((id: string) => void) | undefined;
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
    <div className="tracker-document-fields">
      <section className="tracker-entry-list">
        <div>
          <strong>Variables</strong>
        </div>
        {onEnterEdit ? (
          <EnvFileQuickAdd
            controlsDisabled={controlsDisabled}
            onAddVariable={onAddVariable}
            onPendingChange={onPendingChange}
          />
        ) : null}
        {/* A variable being typed into the expanded quick-add form is the whole
            of the list's business until it is saved, so the (empty) table stays
            out of the way rather than heading it with a "no variables" row. */}
        {variables.length === 0 && entryPending ? null : (
          <EnvFileReadTable
            currentAuthorId={currentAuthorId}
            onEnterEdit={entryPending ? undefined : onEnterEdit}
            resolveRowWriter={resolveRowWriter}
            variables={variables}
          />
        )}
        <div className="tracker-entry-list-footer">
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
  editingVariableId: string | null;
  fileName: string;
  fileNameInputId: string;
  onAddVariable: AddTrackerRow<EnvFileQuickVariable>;
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
    editingVariableId,
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
  const { isRowSaved, saveAddedRow, setRowSaved } = useSavedTrackerRows(
    variables,
    editingVariableId,
  );

  return (
    <div className="tracker-document-fields">
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
      <section className="tracker-entry-list">
        <div>
          <strong>Variables</strong>
        </div>
        <EnvFileQuickAdd
          controlsDisabled={controlsDisabled}
          onAddVariable={(variable) => {
            const addedRow = onAddVariable(variable);
            void saveAddedRow(addedRow);
            return addedRow;
          }}
          onPendingChange={onPendingChange}
        />
        {variables.length === 0 && !entryPending ? (
          <div className="tracker-empty-state">No variables</div>
        ) : null}
        <EnvFileEditRows
          controlsDisabled={controlsDisabled}
          currentAuthorId={currentAuthorId}
          isRowSaved={isRowSaved}
          onRemoveVariable={onRemoveVariable}
          onUpdateVariable={onUpdateVariable}
          resolveRowWriter={resolveRowWriter}
          setRowSaved={setRowSaved}
          variables={variables}
        />
        <div className="tracker-entry-list-footer">
          {variables.length} entries
        </div>
      </section>
    </div>
  );
}

function EnvFileEditRows(params: {
  controlsDisabled: boolean;
  currentAuthorId: string | null;
  isRowSaved: (id: string) => boolean;
  onRemoveVariable: (id: string) => void;
  onUpdateVariable: UpdateEnvVariable;
  resolveRowWriter?: RowWriterResolver | undefined;
  setRowSaved: (id: string, saved: boolean) => void;
  variables: ReadonlyArray<EnvVariableRow>;
}) {
  return params.variables.map((variable, index) =>
    params.isRowSaved(variable.id) ? (
      <EnvFileVariableReadRow
        key={variable.id}
        currentAuthorId={params.currentAuthorId}
        index={index}
        onEnterEdit={() => params.setRowSaved(variable.id, false)}
        resolveRowWriter={params.resolveRowWriter}
        variable={variable}
      />
    ) : (
      <EnvFileVariableEditRow
        key={variable.id}
        controlsDisabled={params.controlsDisabled}
        index={index}
        onRemoveVariable={params.onRemoveVariable}
        onSaveVariable={(id) => params.setRowSaved(id, true)}
        onUpdateVariable={params.onUpdateVariable}
        variable={variable}
      />
    ),
  );
}

export function EnvFileFields(params: {
  currentAuthorId?: string | null;
  disabled?: boolean | undefined;
  editingVariableId?: string | null | undefined;
  fileName: string;
  fileNameInputId: string;
  isEditing?: boolean | undefined;
  onAddVariable: AddTrackerRow<EnvFileQuickVariable>;
  onEnterEdit?: ((id: string) => void) | undefined;
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
    editingVariableId = null,
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
  const [newVariablePending, onPendingChange] = useState(false);
  useStructuredDocumentEditAction({
    disabled: controlsDisabled || newVariablePending,
    editingLabel: "Save",
    id: "env-file-toggle-edit",
    isEditing,
    onToggleEditing,
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
      key={editingVariableId ?? "document"}
      currentAuthorId={currentAuthorId}
      controlsDisabled={controlsDisabled}
      entryPending={newVariablePending}
      editingVariableId={editingVariableId}
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
  const {
    editingRowId: editingVariableId,
    enterRowEdit,
    isEditing,
    toggleEditing,
  } = useTargetedTrackerEditing(canWrite, params.initialEditing);
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
          editingVariableId={editingVariableId}
          fileName={fileName}
          fileNameInputId={fileNameInputId}
          isEditing={isEditing && canWrite}
          resolveRowWriter={resolveRowWriter}
          onEnterEdit={enterRowEdit}
          onAddVariable={(variable) => {
            if (canWrite) {
              return addRow({
                [ENV_FILE_VARIABLE_KEY_FIELD]: variable.key,
                [ENV_FILE_VARIABLE_VALUE_FIELD]: variable.value,
              });
            }
            return Promise.resolve(null);
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
