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
  useReducer,
  useRef,
} from "react";
import { MiniAppStatus } from "../../components/mini-app/MiniAppLayout";
import type { FileViewer } from "../../host/FileViewer";
import { readAutomaticPreviewBlobBytes } from "./documentAttachmentUtils";
import {
  IDLE_PDF_PREVIEW,
  transitionPdfPreview,
  viewPdfPreview,
} from "./fileDocumentPdfPreviewMachine";
import "./FileDocument.css";

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

export function isPdfMimeType(value: string | null | undefined): boolean {
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

function loadPdfPreviewBytes(
  blobStore: BlobStore,
  storageKey: string,
  handlers: {
    isActive: () => boolean;
    logError: (message: string, cause: unknown) => void;
    onFailure: (message: string) => void;
    onLoaded: (bytes: Uint8Array<ArrayBuffer>) => void;
  },
): void {
  void readAutomaticPreviewBlobBytes(blobStore, storageKey)
    .then((value) => {
      if (!value) {
        if (handlers.isActive())
          handlers.onFailure(
            "PDF preview is unavailable or over 5 MiB. You can still download it.",
          );
        return;
      }
      if (handlers.isActive()) handlers.onLoaded(value);
    })
    .catch((readError: unknown) => {
      if (!handlers.isActive()) return;
      if (!isDatabaseUnavailableError(readError)) {
        handlers.logError("Failed to load PDF preview", readError);
      }
      handlers.onFailure("Couldn't load this PDF. You can still download it.");
    });
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
  const [state, dispatch] = useReducer(transitionPdfPreview, IDLE_PDF_PREVIEW);
  const runRef = useRef(0);
  const logErrorRef = useRef(logError);
  logErrorRef.current = logError;
  const storageKey = candidate?.storageKey;
  const { bytes, error, loadedRun, loading } = viewPdfPreview(
    state,
    storageKey,
  );

  useEffect(() => {
    if (!storageKey) {
      dispatch({ type: "cleared" });
      return;
    }
    let active = true;
    const run = ++runRef.current;
    dispatch({ run, storageKey, type: "load-started" });
    loadPdfPreviewBytes(blobStore, storageKey, {
      isActive: () => active,
      logError: (message, cause) => logErrorRef.current(message, cause),
      onFailure: (message) => dispatch({ message, run, type: "load-failed" }),
      onLoaded: (loadedBytes) =>
        dispatch({ bytes: loadedBytes, run, type: "bytes-loaded" }),
    });
    return () => {
      active = false;
    };
  }, [blobStore, storageKey]);

  const onOpenExternal = useCallback(() => {
    if (!bytes || loadedRun === null || !candidate || !fileViewer) return;
    const run = loadedRun;
    dispatch({ run, type: "open-started" });
    void fileViewer
      .viewFile({
        data: bytes,
        fileName: candidate.attachment.name,
        mimeType: candidate.attachment.mimeType,
      })
      .catch((openError: unknown) => {
        logError("Failed to open PDF externally", openError);
        dispatch({
          message: "Couldn't open this PDF in another app.",
          run,
          type: "open-failed",
        });
      });
  }, [bytes, candidate, fileViewer, loadedRun, logError]);

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
