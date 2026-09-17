import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import {
  type BlobStore,
  type DocumentAttachment,
  isDatabaseUnavailableError,
} from "@tearleads/client-sdk";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MiniAppStatus } from "../../components/mini-app/MiniAppLayout";
import type { FileViewer } from "../../host/FileViewer";

const PdfInlineViewer = lazy(() => import("./PdfInlineViewer"));

interface PdfPreviewCandidate {
  attachment: DocumentAttachment;
  storageKey: string;
}

export interface FileDocumentPdfPreview extends PdfPreviewCandidate {
  bytes: Uint8Array<ArrayBuffer> | null;
  error: string | null;
  loading: boolean;
  onOpenExternal: (() => void) | null;
}

function isPdfMimeType(value: string | null | undefined): boolean {
  return value?.split(";")[0]?.trim().toLowerCase() === "application/pdf";
}

export function resolveFileDocumentPdfPreview(
  attachments: ReadonlyArray<DocumentAttachment>,
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>,
): PdfPreviewCandidate | null {
  for (let index = attachments.length - 1; index >= 0; index -= 1) {
    const attachment = attachments[index];
    const storageKey = attachment
      ? attachmentStorageKeyBySlotId[attachment.slotId]
      : undefined;
    if (attachment && storageKey && isPdfMimeType(attachment.mimeType)) {
      return { attachment, storageKey };
    }
  }

  return null;
}

export function useFileDocumentPdfPreview(params: {
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  attachments: ReadonlyArray<DocumentAttachment>;
  blobStore: BlobStore;
  fileViewer: FileViewer | null;
  logError: (message: string | Error, cause?: unknown) => void;
}): FileDocumentPdfPreview | null {
  const {
    attachmentStorageKeyBySlotId,
    attachments,
    blobStore,
    fileViewer,
    logError,
  } = params;
  const candidate = useMemo(
    () =>
      resolveFileDocumentPdfPreview(attachments, attachmentStorageKeyBySlotId),
    [attachmentStorageKeyBySlotId, attachments],
  );
  const [loaded, setLoaded] = useState<{
    storageKey: string;
    bytes: Uint8Array<ArrayBuffer>;
  } | null>(null);
  const [failure, setFailure] = useState<{
    storageKey: string;
    message: string;
  } | null>(null);
  const logErrorRef = useRef(logError);
  logErrorRef.current = logError;
  const storageKey = candidate?.storageKey;
  const bytes =
    loaded && loaded.storageKey === storageKey ? loaded.bytes : null;
  const error =
    failure && failure.storageKey === storageKey ? failure.message : null;
  const loading = Boolean(storageKey && !bytes && !error);

  useEffect(() => {
    let active = true;
    setLoaded(null);
    setFailure(null);
    if (storageKey) {
      void blobStore
        .readBytes(storageKey)
        .then((value) => {
          if (!value) throw new Error("PDF bytes are not available locally.");
          if (active) setLoaded({ storageKey, bytes: value });
        })
        .catch((readError: unknown) => {
          if (!active) return;
          if (!isDatabaseUnavailableError(readError)) {
            logErrorRef.current("Failed to load PDF preview", readError);
          }
          setFailure({
            storageKey,
            message: "Couldn't load this PDF. You can still download it.",
          });
        });
    }
    return () => {
      active = false;
    };
  }, [blobStore, storageKey]);

  const onOpenExternal = useCallback(() => {
    if (!bytes || !candidate || !fileViewer) return;
    void fileViewer
      .viewFile({
        data: bytes,
        fileName: candidate.attachment.name,
        mimeType: candidate.attachment.mimeType,
      })
      .catch((openError: unknown) => {
        logError("Failed to open PDF externally", openError);
        setFailure({
          storageKey: candidate.storageKey,
          message: "Couldn't open this PDF in another app.",
        });
      });
  }, [bytes, candidate, fileViewer, logError]);

  return candidate
    ? {
        ...candidate,
        bytes,
        error,
        loading,
        onOpenExternal: fileViewer ? onOpenExternal : null,
      }
    : null;
}

export function FileDocumentPdfPreviewPanel(params: {
  preview: FileDocumentPdfPreview;
}) {
  const { attachment, bytes, error, loading, onOpenExternal } = params.preview;

  return (
    <section className="file-document-preview" aria-label="PDF preview">
      <div className="file-document-preview-frame">
        {bytes ? (
          <Suspense
            fallback={<MiniAppStatus>Loading PDF viewer...</MiniAppStatus>}
          >
            <PdfInlineViewer
              bytes={bytes}
              fileName={attachment.name}
              onOpenExternal={onOpenExternal}
            />
          </Suspense>
        ) : (
          <div className="file-document-pdf-prompt">
            <FilePdfIcon aria-hidden size={48} />
            <strong>{attachment.name}</strong>
            <MiniAppStatus as="span" tone={error ? "error" : "muted"}>
              {error ?? (loading ? "Loading PDF..." : "PDF unavailable")}
            </MiniAppStatus>
          </div>
        )}
      </div>
      {bytes && error ? (
        <MiniAppStatus tone="error">{error}</MiniAppStatus>
      ) : null}
    </section>
  );
}
