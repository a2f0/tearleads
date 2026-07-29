import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  MiniAppInput,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import {
  MiniAppRow,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../components/mini-app/rows/MiniAppRow";
import { useWindowTitleBarAction } from "../../components/window/WindowMenuContext";
import { useFileSaver } from "../../providers/file-saver/FileSaverProvider";
import { useFileViewer } from "../../providers/file-viewer/FileViewerProvider";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import {
  useDocument,
  useDocumentReadOnly,
} from "../../stores/documents/DocumentsProvider";
import { formatByteLength } from "../../utils/formatByteLength";
import "./FileDocument.css";
import {
  type FileDocumentPdfPreview,
  FileDocumentPdfPreviewPanel,
  useFileDocumentPdfPreview,
} from "./FileDocumentPdfPreview";
import {
  type FileDocumentMediaPreview,
  FileDocumentMediaPreviewPanel,
  useFileDocumentMediaPreview,
} from "./FileDocumentPreview";
import {
  downloadResolvedAttachment,
  resolveDownloadableAttachment,
} from "./fileDownload";
import {
  StructuredDocument,
  useStructuredDocumentEditAction,
  useStructuredDocumentEditing,
} from "./StructuredDocument";

const FILE_DOCUMENT_EMPTY_VALUE = "—";

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

// A metadata field is rendered, never an input: size, MIME type, and the like
// are derived from the uploaded bytes and are not user-editable.
function FileDocumentReadRow(params: FileDocumentField) {
  const trimmed = params.value.trim();
  return (
    <MiniAppRow density="roomy">
      <MiniAppRowStack>
        <strong>{params.label}</strong>
        <MiniAppRowText muted title={trimmed.length > 0 ? trimmed : undefined}>
          {trimmed.length > 0 ? params.value : FILE_DOCUMENT_EMPTY_VALUE}
        </MiniAppRowText>
      </MiniAppRowStack>
    </MiniAppRow>
  );
}

// The file name is the one editable field — renaming a file is renaming its
// document. In view mode it renders like every other row; in edit mode the row
// swaps its value text for an input that commits the rename on blur.
function FileDocumentNameRow(params: {
  disabled: boolean;
  isEditing: boolean;
  label: string;
  onCommit: (value: string) => void;
  value: string;
}) {
  const { disabled, isEditing, label, onCommit, value } = params;
  const inputId = useId();
  const [localValue, setLocalValue] = useState(value);
  // Re-sync on toggle too, so re-entering edit always opens on the canonical
  // name (and a reverted empty edit does not linger).
  useEffect(() => {
    setLocalValue(value);
  }, [value, isEditing]);

  if (!isEditing) {
    return <FileDocumentReadRow label={label} value={value} />;
  }

  const commit = () => {
    const trimmed = localValue.trim();
    // A file must keep a name: an empty/whitespace rename reverts rather than
    // wiping the title to the "Untitled file" fallback.
    if (!disabled && trimmed !== "" && trimmed !== value) {
      onCommit(trimmed);
    } else {
      setLocalValue(value);
    }
  };

  return (
    <MiniAppRow density="roomy">
      <MiniAppRowStack>
        <label htmlFor={inputId}>
          <strong>{label}</strong>
        </label>
        <MiniAppInput
          id={inputId}
          aria-label={label}
          disabled={disabled}
          value={localValue}
          onChange={(event) => setLocalValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          onBlur={commit}
        />
      </MiniAppRowStack>
    </MiniAppRow>
  );
}

const FILE_DOCUMENT_DOWNLOAD_LABEL = "Download";

export function FileDocumentFields({
  canWrite,
  downloadDisabled,
  downloadError,
  editDisabled,
  fileName,
  hideEdit = false,
  isEditing,
  mediaPreview,
  pdfPreview,
  onCommitFileName,
  onDownload,
  onToggleEditing,
  readFields,
}: {
  canWrite: boolean;
  downloadDisabled: boolean;
  downloadError: string | null;
  editDisabled: boolean;
  fileName: string;
  // Removes the Edit control entirely (host-forced read-only, e.g. Trash). The
  // Download control stays available since it is a read action.
  hideEdit?: boolean | undefined;
  isEditing: boolean;
  mediaPreview?: FileDocumentMediaPreview | null | undefined;
  pdfPreview?: FileDocumentPdfPreview | null | undefined;
  onCommitFileName: (value: string) => void;
  onDownload: () => void;
  onToggleEditing: () => void;
  readFields: ReadonlyArray<FileDocumentField>;
}) {
  // Edit and Download are pane-header toolbar actions (rendered in the window
  // and routed chrome), not body buttons. Edit sits left of Download via the
  // higher priority the shared edit action registers with.
  useStructuredDocumentEditAction({
    disabled: editDisabled,
    hidden: hideEdit,
    id: "file-document-toggle-edit",
    isEditing,
    onToggleEditing,
  });

  const downloadAction = useMemo(
    () => ({
      disabled: downloadDisabled,
      icon: <DownloadSimpleIcon aria-hidden size={18} />,
      id: "file-document-download",
      label: FILE_DOCUMENT_DOWNLOAD_LABEL,
      onClick: onDownload,
      priority: 90,
    }),
    [downloadDisabled, onDownload],
  );
  useWindowTitleBarAction(downloadAction);

  // A picture or a PDF takes the pane's spare height; audio (and a view with no
  // preview at all) keeps the plain content-height stack.
  const fillsPane =
    (mediaPreview != null && mediaPreview.mediaKind !== "audio") ||
    pdfPreview != null;

  return (
    <div
      className={`file-document-fields${fillsPane ? " file-document-fields--fill" : ""}`}
    >
      {/* For media, the preview is the point of the view: render it above the
          metadata so it lands on top without a scroll. */}
      {mediaPreview ? (
        <FileDocumentMediaPreviewPanel
          onDownload={downloadDisabled ? undefined : onDownload}
          preview={mediaPreview}
        />
      ) : null}
      {pdfPreview ? <FileDocumentPdfPreviewPanel preview={pdfPreview} /> : null}
      {downloadError ? (
        <MiniAppStatus as="span" tone="error">
          {downloadError}
        </MiniAppStatus>
      ) : null}
      <FileDocumentNameRow
        disabled={!canWrite}
        isEditing={isEditing}
        label="File Name"
        onCommit={onCommitFileName}
        value={fileName}
      />
      {/* Metadata rows are single-line label/value pairs; flow them into a
          responsive multi-column grid so short fields sit side by side instead
          of stacking into a tall column. */}
      <div className="file-document-metadata">
        {readFields.map((field) => (
          <FileDocumentReadRow
            key={field.label}
            label={field.label}
            value={field.value}
          />
        ))}
      </div>
    </div>
  );
}

function useFileDocumentReadFields(params: {
  extraFieldLabels: Readonly<Record<string, string>>;
  structuredFields: Readonly<Record<string, string>>;
}): FileDocumentField[] {
  const { extraFieldLabels, structuredFields } = params;
  return useMemo<FileDocumentField[]>(() => {
    const {
      byteLength = "",
      mimeType = "",
      sourceLastModified = "",
    } = structuredFields;
    const output: FileDocumentField[] = [
      { label: "MIME Type", value: mimeType },
      { label: "Size", value: formatStoredByteLength(byteLength) },
      { label: "Source Modified", value: sourceLastModified },
    ];

    for (const [field, label] of Object.entries(extraFieldLabels)) {
      output.push({ label, value: structuredFields[field] ?? "" });
    }

    return output;
  }, [extraFieldLabels, structuredFields]);
}

// Derives everything the file view renders from the document store + runtime:
// the read-only metadata rows, the rename commit, the download handler, and the
// edit/download enablement. Kept as a hook so the component stays a thin shell.
function useFileDocument(params: {
  extraFieldLabels: Readonly<Record<string, string>>;
  initialEditing?: boolean | undefined;
  title: string;
}) {
  const { extraFieldLabels, initialEditing, title } = params;
  const { infra } = useTearleadsRuntime();
  const fileSaver = useFileSaver();
  const fileViewer = useFileViewer();
  const {
    attachments,
    attachmentStorageKeyBySlotId,
    canWrite,
    documentKind,
    ready,
    setStructuredFields,
    structuredFields,
  } = useDocument();
  const [isEditing, setIsEditing] = useStructuredDocumentEditing(
    ready && canWrite,
    initialEditing,
  );
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { fileName = "" } = structuredFields;
  const readFields = useFileDocumentReadFields({
    extraFieldLabels,
    structuredFields,
  });

  const downloadable = useMemo(
    () =>
      resolveDownloadableAttachment(attachments, attachmentStorageKeyBySlotId),
    [attachments, attachmentStorageKeyBySlotId],
  );
  const mediaPreview = useFileDocumentMediaPreview({
    attachments,
    attachmentStorageKeyBySlotId,
    blobStore: infra.blobStore,
  });
  const pdfPreview = useFileDocumentPdfPreview({
    attachments,
    attachmentStorageKeyBySlotId,
    blobStore: infra.blobStore,
    fileViewer,
  });

  const commitFileName = useCallback(
    (value: string) => {
      // documentKind is a file kind here (never "note"): the guard asserts that
      // and satisfies setStructuredFields' non-note signature.
      if (canWrite && documentKind !== "note") {
        void setStructuredFields(documentKind, { fileName: value });
      }
    },
    [canWrite, documentKind, setStructuredFields],
  );

  const handleDownload = useCallback(() => {
    if (!downloadable) {
      return;
    }
    setDownloadError(null);
    void downloadResolvedAttachment({
      attachment: downloadable,
      blobStore: infra.blobStore,
      fallbackFileName: fileName.trim() || title,
      fileSaver,
    })
      .then((succeeded) => {
        if (!succeeded) {
          setDownloadError(
            "This file's contents haven't downloaded to this device yet.",
          );
        }
      })
      .catch((error: unknown) => {
        // A blob-store read can fail (corrupt/unreadable local bytes); surface
        // it instead of leaving an unhandled rejection.
        console.error("Failed to download attachment:", error);
        setDownloadError("Couldn't download this file.");
      });
  }, [downloadable, fileName, fileSaver, infra.blobStore, title]);

  const toggleEditing = useCallback(
    () => setIsEditing((editing) => !editing),
    [],
  );

  return {
    canWrite,
    commitFileName,
    downloadError,
    downloadable,
    fileName,
    handleDownload,
    isEditing,
    mediaPreview,
    pdfPreview,
    readFields,
    ready,
    toggleEditing,
  };
}

export function FileDocument(params: {
  extraFieldLabels?: Readonly<Record<string, string>> | undefined;
  initialEditing?: boolean | undefined;
  title: string;
}) {
  const { extraFieldLabels = {}, initialEditing, title } = params;
  const model = useFileDocument({ extraFieldLabels, initialEditing, title });
  const readOnly = useDocumentReadOnly();

  return (
    <StructuredDocument
      fields={
        <FileDocumentFields
          canWrite={model.canWrite}
          downloadDisabled={model.downloadable === null}
          downloadError={model.downloadError}
          editDisabled={!model.ready || !model.canWrite}
          fileName={model.fileName}
          hideEdit={readOnly}
          isEditing={model.isEditing}
          mediaPreview={model.mediaPreview}
          pdfPreview={model.pdfPreview}
          onCommitFileName={model.commitFileName}
          onDownload={model.handleDownload}
          onToggleEditing={model.toggleEditing}
          readFields={model.readFields}
        />
      }
    />
  );
}
