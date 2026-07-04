import type { PropsWithChildren, ReactNode } from "react";
import "./StructuredDocument.css";

interface StructuredDocumentAttachmentCopy {
  authenticatedOnline: string;
  localOnly: string;
  unavailable: string;
}

function getAttachmentCopy(params: {
  attachmentCopy: StructuredDocumentAttachmentCopy;
  canAttach: boolean;
  isAuthenticated: boolean;
  online: boolean;
}) {
  const { attachmentCopy, canAttach, isAuthenticated, online } = params;
  if (!canAttach) {
    return attachmentCopy.unavailable;
  }

  return isAuthenticated && online
    ? attachmentCopy.authenticatedOnline
    : attachmentCopy.localOnly;
}

export function StructuredDocument(params: {
  attachmentCopy?: StructuredDocumentAttachmentCopy | undefined;
  attachments?: ReactNode;
  canAttach?: boolean | undefined;
  fields: ReactNode;
  isAuthenticated: boolean;
  online: boolean;
  ready: boolean;
  syncing: boolean;
  title: string;
}) {
  const {
    attachmentCopy,
    attachments,
    canAttach = false,
    fields,
    isAuthenticated,
    online,
    ready,
    syncing,
    title,
  } = params;

  return (
    <div className="structured-document">
      <div className="structured-document-header">
        <div className="structured-document-title">
          <strong>{title}</strong>
          <span className="structured-document-status">
            {!ready ? "Loading..." : syncing ? "Syncing..." : "Ready"}
          </span>
        </div>
        {attachmentCopy ? (
          <span className="structured-document-status">
            {getAttachmentCopy({
              attachmentCopy,
              canAttach,
              isAuthenticated,
              online,
            })}
          </span>
        ) : null}
      </div>
      {fields}
      {attachments ?? null}
    </div>
  );
}

export function StructuredDocumentFields({ children }: PropsWithChildren) {
  return <div className="structured-document-fields">{children}</div>;
}

export function StructuredDocumentField(
  params: PropsWithChildren<{
    inputId: string;
    label: string;
  }>,
) {
  const { children, inputId, label } = params;

  return (
    <label className="structured-document-field" htmlFor={inputId}>
      {label}
      {children}
    </label>
  );
}
