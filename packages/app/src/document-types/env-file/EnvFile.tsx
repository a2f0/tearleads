import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useId, useMemo } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
} from "../shared/StructuredDocument";
import {
  type EnvFileDocumentFields,
  type EnvFileVariable,
  readEnvFileFields,
  serializeEnvFileVariables,
} from "./envFileDocument";
import {
  ENV_FILE_DOCUMENT_KIND,
  ENV_FILE_VARIABLES_FIELD,
} from "./envFileDocumentDefinition";
import "./EnvFile.css";

function createLocalVariableId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `env-${Date.now()}`;
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

export function EnvFileFields(params: {
  fields: EnvFileDocumentFields;
  fileNameInputId: string;
  onChange: (patch: Record<string, string>) => void;
  ready: boolean;
}) {
  const { fields, fileNameInputId, onChange, ready } = params;

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
            disabled={!ready}
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
            disabled={!ready}
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
            <div className="env-file-variable-row" key={variable.id}>
              <label className="env-file-variable-field">
                Key
                <input
                  aria-label={`Env variable ${index + 1} key`}
                  value={variable.key}
                  onChange={(event) =>
                    commitVariables(
                      updateVariable(fields.variables, variable.id, {
                        key: event.target.value,
                      }),
                    )
                  }
                  placeholder="API_TOKEN"
                  disabled={!ready}
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
                      updateVariable(fields.variables, variable.id, {
                        value: event.target.value,
                      }),
                    )
                  }
                  placeholder="secret"
                  disabled={!ready}
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button
                aria-label={`Remove env variable ${index + 1}`}
                className="env-file-remove-button"
                disabled={!ready}
                onClick={() =>
                  commitVariables(
                    fields.variables.filter(
                      (candidate) => candidate.id !== variable.id,
                    ),
                  )
                }
                title={`Remove env variable ${index + 1}`}
                type="button"
              >
                <TrashIcon aria-hidden size={14} />
                Remove
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

export function EnvFile() {
  const { auth, state } = useTearleadsRuntime();
  const { isAuthenticated } = auth;
  const { online } = state;
  const { ready, setStructuredFields, structuredFields, syncing } =
    useDocument();
  const fields = useMemo(
    () => readEnvFileFields(structuredFields),
    [structuredFields],
  );
  const fileNameInputId = useId();

  return (
    <StructuredDocument
      fields={
        <EnvFileFields
          fields={fields}
          fileNameInputId={fileNameInputId}
          onChange={(patch) => {
            setStructuredFields(ENV_FILE_DOCUMENT_KIND, patch);
          }}
          ready={ready}
        />
      }
      isAuthenticated={isAuthenticated}
      online={online}
      ready={ready}
      syncing={syncing}
      title=".env File"
    />
  );
}
