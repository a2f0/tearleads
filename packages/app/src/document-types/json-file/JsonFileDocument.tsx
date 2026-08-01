import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
  StructuredDocumentReadFields,
  useStructuredDocumentEditAction,
  useStructuredDocumentEditing,
} from "../shared/StructuredDocument";
import {
  JSON_FILE_DOCUMENT_KIND,
  readJsonFileFields,
} from "./jsonFileDocumentDefinition";
import "./JsonFileDocument.css";

type JsonFilePatch = Record<string, string>;
const JSON_TEXT_COMMIT_DEBOUNCE_MS = 250;

function useDebouncedJsonText(params: {
  controlsDisabled: boolean;
  onChangeText: (value: string) => void;
  text: string;
}) {
  const { controlsDisabled, onChangeText, text } = params;
  const [draftText, setDraftText] = useState(text);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraftRef = useRef(text);
  const committedTextRef = useRef(text);
  const onChangeTextRef = useRef(onChangeText);
  const canCommitRef = useRef(!controlsDisabled);

  onChangeTextRef.current = onChangeText;
  canCommitRef.current = !controlsDisabled;

  const clearPendingCommit = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const commitDraft = useCallback(
    (value: string) => {
      clearPendingCommit();
      if (!canCommitRef.current || value === committedTextRef.current) {
        return;
      }

      committedTextRef.current = value;
      onChangeTextRef.current(value);
    },
    [clearPendingCommit],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const nextText = event.currentTarget.value;
      latestDraftRef.current = nextText;
      setDraftText(nextText);
      clearPendingCommit();
      timeoutRef.current = setTimeout(() => {
        commitDraft(nextText);
      }, JSON_TEXT_COMMIT_DEBOUNCE_MS);
    },
    [clearPendingCommit, commitDraft],
  );

  const handleBlur = useCallback(() => {
    commitDraft(latestDraftRef.current);
  }, [commitDraft]);

  useEffect(() => {
    if (text === committedTextRef.current) {
      return;
    }

    clearPendingCommit();
    committedTextRef.current = text;
    latestDraftRef.current = text;
    setDraftText(text);
  }, [clearPendingCommit, text]);

  useEffect(
    () => () => {
      clearPendingCommit();
      if (
        canCommitRef.current &&
        latestDraftRef.current !== committedTextRef.current
      ) {
        onChangeTextRef.current(latestDraftRef.current);
      }
    },
    [clearPendingCommit],
  );

  return { draftText, handleBlur, handleChange };
}

function JsonFileReadFields(params: {
  fields: ReturnType<typeof readJsonFileFields>;
  text: string;
}) {
  const fileName = params.fields.fileName ?? "";
  return (
    <div className="json-file-document-fields">
      <StructuredDocumentReadFields
        fields={[{ label: "File Name", value: fileName }]}
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
  const fileName = params.fields.fileName ?? "";
  const { draftText, handleBlur, handleChange } = useDebouncedJsonText({
    controlsDisabled: params.controlsDisabled,
    onChangeText: params.onChangeText,
    text: params.text,
  });

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
            value={fileName}
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
          value={draftText}
          onChange={handleChange}
          onBlur={handleBlur}
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
  onToggleEditing: () => void;
  ready: boolean;
  text: string | null | undefined;
}) {
  const {
    contentInputId,
    disabled = false,
    fields,
    fileNameInputId,
    isEditing = false,
    onChangeFields,
    onChangeText,
    onToggleEditing,
    ready,
    text,
  } = params;
  const controlsDisabled = disabled || !ready;
  useStructuredDocumentEditAction({
    disabled: controlsDisabled,
    id: "json-file-document-toggle-edit",
    isEditing,
    onToggleEditing,
  });
  const safeText = text ?? "";

  if (!isEditing) {
    return <JsonFileReadFields fields={fields} text={safeText} />;
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
      text={safeText}
    />
  );
}

export function JsonFileDocument(params: {
  initialEditing?: boolean | undefined;
}) {
  const {
    canWrite,
    ready,
    setStructuredFields,
    setText,
    structuredFields,
    text,
  } = useDocument();
  const fields = useMemo(
    () => readJsonFileFields(structuredFields ?? {}),
    [structuredFields],
  );
  const fileNameInputId = useId();
  const contentInputId = useId();
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
  return (
    <StructuredDocument
      fields={
        <JsonFileFields
          contentInputId={contentInputId}
          disabled={!ready || !canWrite}
          fields={fields}
          fileNameInputId={fileNameInputId}
          isEditing={isEditing && canWrite}
          onToggleEditing={toggleEditing}
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
      }
    />
  );
}
