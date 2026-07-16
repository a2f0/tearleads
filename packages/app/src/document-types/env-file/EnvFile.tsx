import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { DocumentRow } from "@tearleads/client-sdk";
import { useId } from "react";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { formatRowAttribution } from "../shared/rowAttribution";
import {
  StructuredDocument,
  StructuredDocumentEditActions,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import { useDocumentRowEditing } from "../shared/useDocumentRowEditing";
import {
  ENV_FILE_DOCUMENT_KIND,
  ENV_FILE_NAME_FIELD,
  ENV_FILE_VARIABLE_KEY_FIELD,
  ENV_FILE_VARIABLE_NAME_PATTERN,
  ENV_FILE_VARIABLE_VALUE_FIELD,
  isValidEnvFileVariableName,
} from "./envFileDocumentDefinition";
import "./EnvFile.css";

type EnvVariableField =
  | typeof ENV_FILE_VARIABLE_KEY_FIELD
  | typeof ENV_FILE_VARIABLE_VALUE_FIELD;

type ReadRowCell = (id: string, field: string, storeValue: string) => string;

export interface EnvVariableRow {
  id: string;
  key: string;
  value: string;
  updatedAt: string;
  updatedBy: string;
}

function readFileNameField(
  structuredFields: Readonly<Record<string, string>>,
): string {
  const value = structuredFields[ENV_FILE_NAME_FIELD];
  return typeof value === "string" ? value : "";
}

function toEnvVariableRows(
  rows: ReadonlyArray<DocumentRow>,
  readCell: ReadRowCell,
): EnvVariableRow[] {
  return rows.map((row) => ({
    id: row.id,
    key: readCell(
      row.id,
      ENV_FILE_VARIABLE_KEY_FIELD,
      row.fields[ENV_FILE_VARIABLE_KEY_FIELD] ?? "",
    ),
    value: readCell(
      row.id,
      ENV_FILE_VARIABLE_VALUE_FIELD,
      row.fields[ENV_FILE_VARIABLE_VALUE_FIELD] ?? "",
    ),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }));
}

const ENV_FILE_EMPTY_VALUE = "None";
const ENV_FILE_MASKED_VALUE = "********";
const ENV_FILE_SENSITIVE_KEY_PATTERN =
  /(?:^|_)(?:PASSWORD|PASS|PWD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|ACCESS_KEY)(?:_|$)/u;

function shouldMaskEnvFileVariable(variable: EnvVariableRow): boolean {
  return ENV_FILE_SENSITIVE_KEY_PATTERN.test(variable.key.trim().toUpperCase());
}

function getEnvFileReadValue(value: string): string {
  return value.trim().length > 0 ? value : ENV_FILE_EMPTY_VALUE;
}

function getEnvFileVariableReadValue(variable: EnvVariableRow): string {
  if (variable.value.trim().length === 0) {
    return ENV_FILE_EMPTY_VALUE;
  }

  return shouldMaskEnvFileVariable(variable)
    ? ENV_FILE_MASKED_VALUE
    : variable.value;
}

function EnvFileVariableReadRow(params: {
  currentAuthorId: string | null;
  index: number;
  variable: EnvVariableRow;
}) {
  const { currentAuthorId, index, variable } = params;
  const keyTitle = variable.key.trim();
  const valueTitle = shouldMaskEnvFileVariable(variable)
    ? undefined
    : variable.value.trim();
  const attribution = formatRowAttribution({
    currentAuthorId,
    updatedAt: variable.updatedAt,
    updatedBy: variable.updatedBy,
  });

  return (
    <div className="env-file-variable-read-row">
      <span className="env-file-variable-read-cell">
        <strong>Key</strong>
        <span
          className="env-file-variable-read-value"
          title={keyTitle.length > 0 ? keyTitle : undefined}
        >
          {getEnvFileReadValue(variable.key)}
        </span>
      </span>
      <span className="env-file-variable-read-cell">
        <strong>Value</strong>
        <span
          className="env-file-variable-read-value"
          title={valueTitle && valueTitle.length > 0 ? valueTitle : undefined}
        >
          {getEnvFileVariableReadValue(variable)}
        </span>
      </span>
      <span className="env-file-variable-read-index">{index + 1}</span>
      {attribution ? (
        <span className="env-file-variable-read-attribution">
          {attribution}
        </span>
      ) : null}
    </div>
  );
}

function EnvFileReadFields(params: {
  currentAuthorId: string | null;
  fileName: string;
  variables: ReadonlyArray<EnvVariableRow>;
}) {
  const { currentAuthorId, fileName, variables } = params;

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
    variables,
  } = params;
  const controlsDisabled = disabled || !ready;

  if (!isEditing) {
    return (
      <EnvFileReadFields
        currentAuthorId={currentAuthorId}
        fileName={fileName}
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
