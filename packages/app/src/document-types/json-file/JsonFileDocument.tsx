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
  JSON_FILE_DOCUMENT_KIND,
  readJsonFileFields,
} from "./jsonFileDocumentDefinition";
import "./JsonFileDocument.css";

type JsonFilePatch = Record<string, string>;

function JsonFileReadFields(params: {
  fields: ReturnType<typeof readJsonFileFields>;
  text: string;
}) {
  return (
    <div className="json-file-document-fields">
      <StructuredDocumentReadFields
        fields={[{ label: "File Name", value: params.fields.fileName }]}
      />
      <section className="json-file-content-section">
        <strong>Content</strong>
        {params.text.trim().length === 0 ? (
          <div className="json-file-empty-state">No JSON content</div>
        ) : (
          <pre className="json-file-content-view">{params.text}</pre>
        )}
      </section>
    </div>
  );
}

function JsonFileEditFields(params: {
  contentInputId: string;
  controlsDisabled: boolean;
  fields: ReturnType<typeof readJsonFileFields>;
  fileNameInputId: string;
  onChangeFields: (patch: JsonFilePatch) => void;
  onChangeText: (value: string) => void;
  ready: boolean;
  text: string;
}) {
  return (
    <div className="json-file-document-fields">
      <StructuredDocumentFields>
        <StructuredDocumentField
          inputId={params.fileNameInputId}
          label="File Name"
        >
          <input
            id={params.fileNameInputId}
            aria-label="JSON file name"
            value={params.fields.fileName}
            onChange={(event) =>
              params.onChangeFields({ fileName: event.target.value })
            }
            placeholder={params.ready ? "data.json" : "Loading..."}
            disabled={params.controlsDisabled}
            autoComplete="off"
          />
        </StructuredDocumentField>
      </StructuredDocumentFields>
      <label
        className="json-file-content-field"
        htmlFor={params.contentInputId}
      >
        Content
        <textarea
          id={params.contentInputId}
          aria-label="JSON content"
          value={params.text}
          onChange={(event) => params.onChangeText(event.target.value)}
          placeholder={params.ready ? "{}" : "Loading..."}
          disabled={params.controlsDisabled}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
    </div>
  );
}

export function JsonFileFields(params: {
  contentInputId: string;
  disabled?: boolean | undefined;
  fields: ReturnType<typeof readJsonFileFields>;
  fileNameInputId: string;
  isEditing?: boolean | undefined;
  onChangeFields: (patch: JsonFilePatch) => void;
  onChangeText: (value: string) => void;
  ready: boolean;
  text: string;
}) {
  const {
    contentInputId,
    disabled = false,
    fields,
    fileNameInputId,
    isEditing = false,
    onChangeFields,
    onChangeText,
    ready,
    text,
  } = params;
  const controlsDisabled = disabled || !ready;

  if (!isEditing) {
    return <JsonFileReadFields fields={fields} text={text} />;
  }

  return (
    <JsonFileEditFields
      contentInputId={contentInputId}
      controlsDisabled={controlsDisabled}
      fields={fields}
      fileNameInputId={fileNameInputId}
      onChangeFields={onChangeFields}
      onChangeText={onChangeText}
      ready={ready}
      text={text}
    />
  );
}

export function JsonFileDocument() {
  const { auth, state } = useTearleadsRuntime();
  const { isAuthenticated } = auth;
  const { online } = state;
  const {
    canWrite,
    ready,
    setStructuredFields,
    setText,
    structuredFields,
    syncing,
    text,
  } = useDocument();
  const fields = useMemo(
    () => readJsonFileFields(structuredFields),
    [structuredFields],
  );
  const fileNameInputId = useId();
  const contentInputId = useId();
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
          <JsonFileFields
            contentInputId={contentInputId}
            disabled={!ready || !canWrite}
            fields={fields}
            fileNameInputId={fileNameInputId}
            isEditing={isEditing && canWrite}
            onChangeFields={(patch) => {
              if (canWrite) {
                void setStructuredFields(JSON_FILE_DOCUMENT_KIND, patch);
              }
            }}
            onChangeText={(value) => {
              if (canWrite) {
                void setText(value);
              }
            }}
            ready={ready}
            text={text}
          />
        </>
      }
      isAuthenticated={isAuthenticated}
      online={online}
      ready={ready}
      syncing={syncing}
      title="JSON File"
    />
  );
}
