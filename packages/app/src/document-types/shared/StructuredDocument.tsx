import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { useWindowTitleBarAction } from "@tearleads/windowing";
import {
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../components/mini-app/rows/MiniAppRow";
import { useDocumentReadOnly } from "../../stores/documents/DocumentsProvider";
import "./StructuredDocument.css";
import {
  initialStructuredDocumentEditingState,
  transitionStructuredDocumentEditing,
} from "./structuredDocumentEditingMachine";

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
}

const STRUCTURED_DOCUMENT_EMPTY_VALUE = "None";

/**
 * A structured document's edit mode. `initialEditing` is a request (a new
 * document opens in edit mode): it applies when the hook mounts with it or it
 * turns true, waiting for write access if needed, and is not re-applied when
 * write access later changes. Returns `[isEditing, enterEditing,
 * toggleEditing]`; both actions are reference-stable so the toolbar action
 * they feed does not re-register on every render, and both are ignored while
 * the document is not writable.
 */
export function useStructuredDocumentEditing(
  canWrite: boolean,
  initialEditing = false,
) {
  const [state, dispatch] = useReducer(
    transitionStructuredDocumentEditing,
    { canWrite, initialEditing },
    initialStructuredDocumentEditingState,
  );

  // Write access first, so a render that grants access and requests editing
  // together resolves to editing.
  useEffect(() => {
    dispatch({ canWrite, type: "write-access-changed" });
  }, [canWrite]);

  useEffect(() => {
    if (initialEditing) {
      dispatch({ type: "initial-edit-requested" });
    }
  }, [initialEditing]);

  const enterEditing = useCallback(
    () => dispatch({ type: "edit-entered" }),
    [],
  );
  const toggleEditing = useCallback(() => dispatch({ type: "toggled" }), []);

  return [state.status === "editing", enterEditing, toggleEditing] as const;
}

// The type label and load/sync status this once rendered duplicated the host
// chrome above it (the Explorer detail header already shows the document title
// and a durable sync badge), so the document owns only its own body now.
export function StructuredDocument(params: StructuredDocumentProps) {
  const { attachments, fields, leading } = params;

  return (
    <div className="structured-document">
      {leading ?? null}
      {fields}
      {attachments ?? null}
    </div>
  );
}

const STRUCTURED_DOCUMENT_EDIT_ACTION = "Edit";
const STRUCTURED_DOCUMENT_DONE_ACTION = "Done";

/**
 * Register a document's edit toggle as a pane-header toolbar action (the
 * pencil, becoming a check while editing). Documents that also provide an
 * explicit body finish action should pass the same `editingLabel` so both
 * controls describe the shared transition consistently.
 *
 * Every structured document places this control identically, so the toolbar
 * registration lives here instead of being repeated per document type. Pass a
 * reference-stable `onToggleEditing` — the action is memoized on it, and a new
 * closure each render would re-register the toolbar action on every render.
 *
 * A host-forced read-only document (e.g. one opened from the Trash) drops the
 * affordance entirely rather than showing it disabled: the whole document is
 * read-only, not merely un-editable right now. `hidden` does the same for a
 * host that supplies its own edit control.
 */
export function useStructuredDocumentEditAction(params: {
  disabled: boolean;
  editingLabel?: string | undefined;
  hidden?: boolean | undefined;
  id: string;
  isEditing: boolean;
  onToggleEditing: () => void;
}): void {
  const {
    disabled,
    editingLabel = STRUCTURED_DOCUMENT_DONE_ACTION,
    hidden = false,
    id,
    isEditing,
    onToggleEditing,
  } = params;
  const readOnly = useDocumentReadOnly();
  const editAction = useMemo(
    () => ({
      disabled,
      icon: isEditing ? (
        <CheckIcon aria-hidden size={18} />
      ) : (
        <PencilSimpleIcon aria-hidden size={18} />
      ),
      id,
      label: isEditing ? editingLabel : STRUCTURED_DOCUMENT_EDIT_ACTION,
      onClick: onToggleEditing,
      priority: 100,
    }),
    [disabled, editingLabel, id, isEditing, onToggleEditing],
  );

  useWindowTitleBarAction(readOnly || hidden ? null : editAction);
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
