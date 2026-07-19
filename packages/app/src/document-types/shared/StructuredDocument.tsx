import {
  type PropsWithChildren,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import {
  MiniAppActions,
  MiniAppButton,
} from "../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../components/mini-app/rows/MiniAppRow";
import { useDocumentReadOnly } from "../../stores/documents/DocumentsProvider";
import "./StructuredDocument.css";

interface StructuredDocumentReadFieldDescriptor {
  readonly action?: ReactNode;
  readonly displayValue?: string | undefined;
  readonly label: string;
  readonly title?: string | undefined;
  readonly value: string | null | undefined;
}

interface StructuredDocumentProps {
  // Trailing file lists (scans, photos) — rendered below the fields.
  attachments?: ReactNode;
  fields: ReactNode;
  // Identity media that heads the document, such as a contact's avatar.
  // Distinct from `attachments` so it keeps the leading position the Contacts
  // mini-app's detail panel gives it.
  leading?: ReactNode;
  ready: boolean;
  syncing: boolean;
  title: string;
}

const STRUCTURED_DOCUMENT_EMPTY_VALUE = "None";

export function useStructuredDocumentEditing(
  canWrite: boolean,
  initialEditing = false,
) {
  const [isEditing, setIsEditing] = useState(() => initialEditing && canWrite);
  const [pendingInitialEditing, setPendingInitialEditing] = useState(
    () => initialEditing && !canWrite,
  );

  useEffect(() => {
    if (!initialEditing) {
      return;
    }

    if (canWrite) {
      setIsEditing(true);
      setPendingInitialEditing(false);
      return;
    }

    setIsEditing(false);
    setPendingInitialEditing(true);
  }, [canWrite, initialEditing]);

  useEffect(() => {
    if (!canWrite) {
      setIsEditing(false);
      return;
    }

    if (pendingInitialEditing) {
      setIsEditing(true);
      setPendingInitialEditing(false);
    }
  }, [canWrite, pendingInitialEditing]);

  return [isEditing, setIsEditing] as const;
}

export function StructuredDocument(params: StructuredDocumentProps) {
  const { attachments, fields, leading, ready, syncing, title } = params;

  return (
    <div className="structured-document">
      <div className="structured-document-header">
        <div className="structured-document-title">
          <strong>{title}</strong>
          <span className="structured-document-status">
            {!ready ? "Loading..." : syncing ? "Syncing..." : "Ready"}
          </span>
        </div>
      </div>
      {leading ?? null}
      {fields}
      {attachments ?? null}
    </div>
  );
}

export function StructuredDocumentEditActions(params: {
  disabled: boolean;
  isEditing: boolean;
  onToggleEditing: () => void;
}) {
  // A host-forced read-only document (e.g. in the Trash) hides the edit control
  // entirely rather than showing it disabled — the whole document is read-only.
  const readOnly = useDocumentReadOnly();
  if (readOnly) {
    return null;
  }

  return (
    <MiniAppActions>
      <MiniAppButton
        disabled={params.disabled}
        onClick={params.onToggleEditing}
      >
        {params.isEditing ? "Done" : "Edit"}
      </MiniAppButton>
    </MiniAppActions>
  );
}

function StructuredDocumentReadField(
  params: StructuredDocumentReadFieldDescriptor,
) {
  const value = params.value ?? "";
  const trimmed = value.trim();
  const displayValue =
    params.displayValue ??
    (trimmed.length > 0 ? value : STRUCTURED_DOCUMENT_EMPTY_VALUE);
  const title =
    params.title ?? (params.displayValue === undefined ? trimmed : undefined);

  return (
    <MiniAppRow density="roomy">
      <MiniAppRowStack>
        <strong>{params.label}</strong>
        <MiniAppRowText
          muted
          title={title && title.length > 0 ? title : undefined}
        >
          {displayValue}
        </MiniAppRowText>
      </MiniAppRowStack>
      {params.action ?? null}
    </MiniAppRow>
  );
}

export function StructuredDocumentReadFields(params: {
  fields: ReadonlyArray<StructuredDocumentReadFieldDescriptor>;
}) {
  return (
    <div className="structured-document-read-fields">
      {params.fields.map((field) => (
        <StructuredDocumentReadField
          key={field.label}
          action={field.action}
          displayValue={field.displayValue}
          label={field.label}
          title={field.title}
          value={field.value}
        />
      ))}
    </div>
  );
}

export function StructuredDocumentFields({ children }: PropsWithChildren) {
  return <div className="structured-document-fields">{children}</div>;
}

export function StructuredDocumentField(
  params: PropsWithChildren<{
    action?: ReactNode;
    inputId: string;
    label: string;
  }>,
) {
  const { action, children, inputId, label } = params;

  if (action === undefined) {
    return (
      <label className="structured-document-field" htmlFor={inputId}>
        {label}
        {children}
      </label>
    );
  }

  // A trailing control can't live inside the <label>: a button is a labelable
  // element, so nesting it there is invalid and its clicks would also trigger
  // the label's own focus-the-input behavior.
  return (
    <div className="structured-document-field">
      <label htmlFor={inputId}>{label}</label>
      <div className="structured-document-field-control">
        {children}
        {action}
      </div>
    </div>
  );
}
