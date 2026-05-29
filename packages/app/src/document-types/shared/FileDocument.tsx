import type { DocumentAttachment } from "@tearleads/client-sdk";
import { useId, useMemo } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import { formatByteLength } from "../../utils/formatByteLength";
import {
  StructuredDocument,
  StructuredDocumentField,
  StructuredDocumentFields,
} from "./StructuredDocument";

interface FileDocumentField {
  label: string;
  value: string;
}

function formatStoredByteLength(value: string): string {
  if (value.trim().length === 0) {
    return value;
  }

  const byteLength = Number(value);
  return Number.isFinite(byteLength) && byteLength >= 0
    ? formatByteLength(byteLength)
    : value;
}

function FileDocumentFields(params: {
  fields: ReadonlyArray<FileDocumentField>;
}) {
  const baseInputId = useId();

  return (
    <StructuredDocumentFields>
      {params.fields.map((field) => {
        const inputId = `${baseInputId}-${field.label
          .toLowerCase()
          .replaceAll(/\W+/gu, "-")}`;
        return (
          <StructuredDocumentField
            key={field.label}
            inputId={inputId}
            label={field.label}
          >
            <input id={inputId} value={field.value} readOnly />
          </StructuredDocumentField>
        );
      })}
    </StructuredDocumentFields>
  );
}

function FileAttachmentRow(params: { attachment: DocumentAttachment }) {
  const { attachment } = params;
  return (
    <section className="structured-document-slot">
      <div className="structured-document-slot-copy">
        <strong>{attachment.name}</strong>
        <span className="structured-document-slot-description">
          {attachment.mimeType ?? "Unknown MIME type"}
        </span>
      </div>
      <div className="structured-document-slot-meta">
        <span className="structured-document-slot-detail">
          {formatByteLength(attachment.byteLength)}
        </span>
      </div>
    </section>
  );
}

function FileDocumentAttachments(params: {
  attachments: ReadonlyArray<DocumentAttachment>;
}) {
  if (params.attachments.length === 0) {
    return (
      <div className="structured-document-slot">
        <div className="structured-document-slot-copy">
          <strong>No file attached</strong>
          <span className="structured-document-slot-description">
            Imported file bytes will appear here once the attachment is staged.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="structured-document-attachments">
      {params.attachments.map((attachment) => (
        <FileAttachmentRow
          key={`${attachment.slotId}:${attachment.name}`}
          attachment={attachment}
        />
      ))}
    </div>
  );
}

export function FileDocument(params: {
  extraFieldLabels?: Readonly<Record<string, string>> | undefined;
  title: string;
}) {
  const { extraFieldLabels = {}, title } = params;
  const { auth, state } = useTearleadsRuntime();
  const { isAuthenticated } = auth;
  const { online } = state;
  const { attachments, canAttach, ready, structuredFields, syncing } =
    useDocument();
  const fields = useMemo<FileDocumentField[]>(() => {
    const {
      byteLength = "",
      fileName = "",
      mimeType = "",
      sourceLastModified = "",
    } = structuredFields;
    const output: FileDocumentField[] = [
      {
        label: "File Name",
        value: fileName,
      },
      {
        label: "MIME Type",
        value: mimeType,
      },
      {
        label: "Size",
        value: formatStoredByteLength(byteLength),
      },
      {
        label: "Source Modified",
        value: sourceLastModified,
      },
    ];

    for (const [field, label] of Object.entries(extraFieldLabels)) {
      output.push({
        label,
        value: structuredFields[field] ?? "",
      });
    }

    return output;
  }, [extraFieldLabels, structuredFields]);

  return (
    <StructuredDocument
      attachmentCopy={{
        authenticatedOnline: "File attachment syncs when online.",
        localOnly: "File attachment is stored locally and syncs when online.",
        unavailable: "File attachments require a local key package.",
      }}
      attachments={<FileDocumentAttachments attachments={attachments} />}
      canAttach={canAttach}
      fields={<FileDocumentFields fields={fields} />}
      isAuthenticated={isAuthenticated}
      online={online}
      ready={ready}
      syncing={syncing}
      title={title}
    />
  );
}
