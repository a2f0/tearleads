import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useId } from "react";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import {
  type RowWriterResolver,
  useDocumentRowWriters,
} from "../../stores/documents/useDocumentRowWriters";
import {
  StructuredDocument,
  StructuredDocumentEditActions,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import { useDocumentRowEditing } from "../shared/useDocumentRowEditing";
import { EnvFileVariableReadRow } from "./EnvFileVariableReadRow";
import {
  ENV_FILE_DOCUMENT_KIND,
  ENV_FILE_NAME_FIELD,
  ENV_FILE_VARIABLE_KEY_FIELD,
  ENV_FILE_VARIABLE_NAME_PATTERN,
  ENV_FILE_VARIABLE_VALUE_FIELD,
  isValidEnvFileVariableName,
} from "./envFileDocumentDefinition";
import { type EnvVariableRow, toEnvVariableRows } from "./envFileVariables";
import "./EnvFile.css";

type EnvVariableField =
  | typeof ENV_FILE_VARIABLE_KEY_FIELD
  | typeof ENV_FILE_VARIABLE_VALUE_FIELD;

function readFileNameField(
  structuredFields: Readonly<Record<string, string>>,
): string {
  const value = structuredFields[ENV_FILE_NAME_FIELD];
  return typeof value === "string" ? value : "";
}

function EnvFileReadFields(params: {
  currentAuthorId: string | null;
  fileName: string;
  resolveRowWriter?: RowWriterResolver | undefined;
  variables: ReadonlyArray<EnvVariableRow>;
}) {
  const { currentAuthorId, fileName, resolveRowWriter, variables } = params;

  return (
    <div className="env-file-document-fields">
      <StructuredDocumentReadFields
        fields={[{ label: "File Name", value: fileName }]}
      />
      <section className="env-file-variable-list">
        <div className="env-file-variable-list-header">
          <div className="env-file-variable-list-title">
            <strong>Variables</strong>
            <span>{variables.length} entries</span>
          </div>
        </div>
        {variables.length === 0 ? (
          <div className="env-file-empty-state">No variables</div>
        ) : (
          variables.map((variable, index) => (
            <EnvFileVariableReadRow
              key={variable.id}
              currentAuthorId={currentAuthorId}
              index={index}
              resolveRowWriter={resolveRowWriter}
              variable={variable}
            />
          ))
        )}
      </section>
    </div>
  );
}

function EnvFileVariableEditRow(params: {
  controlsDisabled: boolean;
  index: number;
  onRemoveVariable: (id: string) => void;
  onUpdateVariable: (
    id: string,
    field: EnvVariableField,
    value: string,
  ) => void;
  variable: EnvVariableRow;
}) {
  const {
    controlsDisabled,
    index,
    onRemoveVariable,
    onUpdateVariable,
    variable,
  } = params;
  const keyIsInvalid =
    variable.key.length > 0 && !isValidEnvFileVariableName(variable.key);

  return (
    <div className="env-file-variable-row">
      <label className="env-file-variable-field">
        Key
        <input
          aria-invalid={keyIsInvalid ? "true" : undefined}
          aria-label={`Env variable ${index + 1} key`}
          value={variable.key}
          onChange={(event) =>
            onUpdateVariable(
              variable.id,
              ENV_FILE_VARIABLE_KEY_FIELD,
              event.target.value,
            )
          }
          pattern={ENV_FILE_VARIABLE_NAME_PATTERN}
          placeholder="API_TOKEN"
          title="Use a POSIX variable name like API_TOKEN."
          disabled={controlsDisabled}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="env-file-variable-field">
        Value
        <input
          aria-label={`Env variable ${index + 1} value`}
          value={variable.value}
          onChange={(event) =>
            onUpdateVariable(
              variable.id,
              ENV_FILE_VARIABLE_VALUE_FIELD,
              event.target.value,
            )
          }
          placeholder="secret"
          disabled={controlsDisabled}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <button
        aria-label={`Remove env variable ${index + 1}`}
        className="env-file-remove-button"
        disabled={controlsDisabled}
        onClick={() => onRemoveVariable(variable.id)}
        title={`Remove env variable ${index + 1}`}
        type="button"
      >
        <TrashIcon aria-hidden size={14} />
        Remove
      </button>
    </div>
  );
}

function EnvFileEditFields(params: {
  controlsDisabled: boolean;
  fileName: string;
  fileNameInputId: string;
  onAddVariable: () => void;
  onRemoveVariable: (id: string) => void;
  onRenameFile: (value: string) => void;
  onUpdateVariable: (
    id: string,
    field: EnvVariableField,
    value: string,
  ) => void;
  ready: boolean;
  variables: ReadonlyArray<EnvVariableRow>;
}) {
  const {
    controlsDisabled,
    fileName,
    fileNameInputId,
    onAddVariable,
    onRemoveVariable,
    onRenameFile,
    onUpdateVariable,
    ready,
    variables,
  } = params;

  return (
    <div className="env-file-document-fields">
      <StructuredDocumentFields>
        <StructuredDocumentField inputId={fileNameInputId} label="File Name">
          <input
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
      <section className="env-file-variable-list">
        <div className="env-file-variable-list-header">
          <div className="env-file-variable-list-title">
            <strong>Variables</strong>
            <span>{variables.length} entries</span>
          </div>
          <button
            className="env-file-add-button"
            disabled={controlsDisabled}
            onClick={onAddVariable}
            type="button"
          >
            <PlusIcon aria-hidden size={14} />
            Add Variable
          </button>
        </div>
        {variables.length === 0 ? (
          <div className="env-file-empty-state">No variables</div>
        ) : (
          variables.map((variable, index) => (
            <EnvFileVariableEditRow
              key={variable.id}
              controlsDisabled={controlsDisabled}
              index={index}
              onRemoveVariable={onRemoveVariable}
              onUpdateVariable={onUpdateVariable}
              variable={variable}
            />
          ))
        )}
      </section>
    </div>
  );
}

export function EnvFileFields(params: {
  currentAuthorId?: string | null;
  disabled?: boolean | undefined;
  fileName: string;
  fileNameInputId: string;
  isEditing?: boolean | undefined;
  onAddVariable: () => void;
  onRemoveVariable: (id: string) => void;
  onRenameFile: (value: string) => void;
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
    onRemoveVariable,
    onRenameFile,
    onUpdateVariable,
    ready,
    resolveRowWriter,
    variables,
  } = params;
  const controlsDisabled = disabled || !ready;

  if (!isEditing) {
    return (
      <EnvFileReadFields
        currentAuthorId={currentAuthorId}
        fileName={fileName}
        resolveRowWriter={resolveRowWriter}
        variables={variables}
      />
    );
  }

  return (
    <EnvFileEditFields
      controlsDisabled={controlsDisabled}
      fileName={fileName}
      fileNameInputId={fileNameInputId}
      onAddVariable={onAddVariable}
      onRemoveVariable={onRemoveVariable}
      onRenameFile={onRenameFile}
      onUpdateVariable={onUpdateVariable}
      ready={ready}
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
    syncing,
    updateRowFields,
  } = useDocument();
  const fileNameInputId = useId();
  const [isEditing, setIsEditing] = useStructuredDocumentEditing(
    canWrite,
    params.initialEditing,
  );
  const { clearRow, readCell, stageCell } = useDocumentRowEditing(rows);
  // Only resolve verified writers for the read view (attribution is not shown
  // while editing) of a non-empty file.
  const resolveRowWriter = useDocumentRowWriters(
    !(isEditing && canWrite) && rows.length > 0,
  );

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
        <>
          <StructuredDocumentEditActions
            disabled={!ready || !canWrite}
            isEditing={isEditing}
            onToggleEditing={() => setIsEditing(!isEditing)}
          />
          <EnvFileFields
            currentAuthorId={currentAuthorId}
            disabled={!ready || !canWrite}
            fileName={fileName}
            fileNameInputId={fileNameInputId}
            isEditing={isEditing && canWrite}
            resolveRowWriter={resolveRowWriter}
            onAddVariable={() => {
              if (canWrite) {
                void addRow({
                  [ENV_FILE_VARIABLE_KEY_FIELD]: "",
                  [ENV_FILE_VARIABLE_VALUE_FIELD]: "",
                });
              }
            }}
            onRemoveVariable={(id) => {
              if (canWrite) {
                void removeRow(id);
              }
              clearRow(id);
            }}
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
        </>
      }
      ready={ready}
      syncing={syncing}
      title=".env File"
    />
  );
}
