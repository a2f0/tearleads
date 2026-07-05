import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useId, useMemo } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import {
  StructuredDocument,
  StructuredDocumentEditActions,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import {
  ENV_FILE_VARIABLE_NAME_PATTERN,
  type EnvFileDocumentFields,
  type EnvFileVariable,
  isValidEnvFileVariableName,
  readEnvFileFields,
  serializeEnvFileVariables,
} from "./envFileDocument";
import {
  ENV_FILE_DOCUMENT_KIND,
  ENV_FILE_VARIABLES_FIELD,
} from "./envFileDocumentDefinition";
import "./EnvFile.css";

let localVariableIdCounter = 0;

function createLocalVariableId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) {
    return randomId;
  }

  localVariableIdCounter += 1;
  return `env-${Date.now()}-${localVariableIdCounter}`;
}

function createBlankVariable(): EnvFileVariable {
  return {
    id: createLocalVariableId(),
    key: "",
    value: "",
  };
}

function updateVariable(
  variables: ReadonlyArray<EnvFileVariable>,
  id: string,
  patch: Partial<Pick<EnvFileVariable, "key" | "value">>,
): EnvFileVariable[] {
  return variables.map((variable) =>
    variable.id === id ? { ...variable, ...patch } : variable,
  );
}

const ENV_FILE_EMPTY_VALUE = "None";
const ENV_FILE_MASKED_VALUE = "********";
const ENV_FILE_SENSITIVE_KEY_PATTERN =
  /(?:^|_)(?:PASSWORD|PASS|PWD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|ACCESS_KEY)(?:_|$)/u;

function normalizeEnvFileReadValue(value: string | null | undefined): string {
  return value ?? "";
}

function getEnvFileReadValue(value: string | null | undefined): string {
  const normalized = normalizeEnvFileReadValue(value);
  return normalized.trim().length > 0 ? normalized : ENV_FILE_EMPTY_VALUE;
}

function shouldMaskEnvFileVariable(
  variable: Partial<EnvFileVariable>,
): boolean {
  return ENV_FILE_SENSITIVE_KEY_PATTERN.test(
    normalizeEnvFileReadValue(variable.key).trim().toUpperCase(),
  );
}

function getEnvFileVariableReadValue(
  variable: Partial<EnvFileVariable>,
): string {
  const value = normalizeEnvFileReadValue(variable.value);
  if (value.trim().length === 0) {
    return ENV_FILE_EMPTY_VALUE;
  }

  return shouldMaskEnvFileVariable(variable) ? ENV_FILE_MASKED_VALUE : value;
}

function EnvFileVariableReadRow(params: {
  index: number;
  variable: EnvFileVariable;
}) {
  const { index, variable } = params;
  const key = normalizeEnvFileReadValue(variable.key);
  const value = normalizeEnvFileReadValue(variable.value);
  const keyTitle = key.trim();
  const valueTitle = shouldMaskEnvFileVariable(variable)
    ? undefined
    : value.trim();

  return (
    <div className="env-file-variable-read-row">
      <span className="env-file-variable-read-cell">
        <strong>Key</strong>
        <span
          className="env-file-variable-read-value"
          title={keyTitle.length > 0 ? keyTitle : undefined}
        >
          {getEnvFileReadValue(key)}
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
    </div>
  );
}

type EnvFilePatch = Record<string, string>;
type EnvFileVariableCommit = (
  variables: ReadonlyArray<EnvFileVariable>,
) => void;

function EnvFileReadFields(params: { fields: EnvFileDocumentFields }) {
  const { fields } = params;

  return (
    <div className="env-file-document-fields">
      <StructuredDocumentReadFields
        fields={[{ label: "File Name", value: fields.fileName }]}
      />
      <section className="env-file-variable-list">
        <div className="env-file-variable-list-header">
          <div className="env-file-variable-list-title">
            <strong>Variables</strong>
            <span>{fields.variables.length} entries</span>
          </div>
        </div>
        {fields.variables.length === 0 ? (
          <div className="env-file-empty-state">No variables</div>
        ) : (
          fields.variables.map((variable, index) => (
            <EnvFileVariableReadRow
              key={variable.id}
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
  commitVariables: EnvFileVariableCommit;
  controlsDisabled: boolean;
  index: number;
  variable: EnvFileVariable;
  variables: ReadonlyArray<EnvFileVariable>;
}) {
  const { commitVariables, controlsDisabled, index, variable, variables } =
    params;
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
          onChange={(event) => {
            commitVariables(
              updateVariable(variables, variable.id, {
                key: event.target.value,
              }),
            );
          }}
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
            commitVariables(
              updateVariable(variables, variable.id, {
                value: event.target.value,
              }),
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
        onClick={() =>
          commitVariables(
            variables.filter((candidate) => candidate.id !== variable.id),
          )
        }
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
  fields: EnvFileDocumentFields;
  fileNameInputId: string;
  onChange: (patch: EnvFilePatch) => void;
  ready: boolean;
}) {
  const { controlsDisabled, fields, fileNameInputId, onChange, ready } = params;

  function commitVariables(variables: ReadonlyArray<EnvFileVariable>) {
    onChange({
      [ENV_FILE_VARIABLES_FIELD]: serializeEnvFileVariables(variables),
    });
  }

  return (
    <div className="env-file-document-fields">
      <StructuredDocumentFields>
        <StructuredDocumentField inputId={fileNameInputId} label="File Name">
          <input
            id={fileNameInputId}
            aria-label=".env file name"
            value={fields.fileName}
            onChange={(event) => onChange({ fileName: event.target.value })}
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
            <span>{fields.variables.length} entries</span>
          </div>
          <button
            className="env-file-add-button"
            disabled={controlsDisabled}
            onClick={() =>
              commitVariables([...fields.variables, createBlankVariable()])
            }
            type="button"
          >
            <PlusIcon aria-hidden size={14} />
            Add Variable
          </button>
        </div>
        {fields.variables.length === 0 ? (
          <div className="env-file-empty-state">No variables</div>
        ) : (
          fields.variables.map((variable, index) => (
            <EnvFileVariableEditRow
              key={variable.id}
              commitVariables={commitVariables}
              controlsDisabled={controlsDisabled}
              index={index}
              variable={variable}
              variables={fields.variables}
            />
          ))
        )}
      </section>
    </div>
  );
}

export function EnvFileFields(params: {
  disabled?: boolean | undefined;
  fields: EnvFileDocumentFields;
  fileNameInputId: string;
  isEditing?: boolean | undefined;
  onChange: (patch: EnvFilePatch) => void;
  ready: boolean;
}) {
  const {
    disabled = false,
    fields,
    fileNameInputId,
    isEditing = true,
    onChange,
    ready,
  } = params;
  const controlsDisabled = disabled || !ready;

  if (!isEditing) {
    return <EnvFileReadFields fields={fields} />;
  }

  return (
    <EnvFileEditFields
      controlsDisabled={controlsDisabled}
      fields={fields}
      fileNameInputId={fileNameInputId}
      onChange={onChange}
      ready={ready}
    />
  );
}

export function EnvFile() {
  const { auth, state } = useTearleadsRuntime();
  const { isAuthenticated } = auth;
  const { online } = state;
  const { canWrite, ready, setStructuredFields, structuredFields, syncing } =
    useDocument();
  const fields = useMemo(
    () => readEnvFileFields(structuredFields),
    [structuredFields],
  );
  const fileNameInputId = useId();
  const [isEditing, setIsEditing] = useStructuredDocumentEditing(canWrite);

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
            disabled={!ready || !canWrite}
            fields={fields}
            fileNameInputId={fileNameInputId}
            isEditing={isEditing && canWrite}
            onChange={(patch) => {
              if (canWrite) {
                setStructuredFields(ENV_FILE_DOCUMENT_KIND, patch);
              }
            }}
            ready={ready}
          />
        </>
      }
      isAuthenticated={isAuthenticated}
      online={online}
      ready={ready}
      syncing={syncing}
      title=".env File"
    />
  );
}
