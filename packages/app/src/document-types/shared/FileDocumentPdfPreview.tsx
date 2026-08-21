import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import type { BlobStore, DocumentAttachment } from "@symcrypt/client-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import type { FileViewer } from "../../host/FileViewer";

interface PdfPreviewCandidate {
  attachment: DocumentAttachment;
  storageKey: string;
}

export interface FileDocumentPdfPreview extends PdfPreviewCandidate {
  error: string | null;
  loading: boolean;
  native: boolean;
  onOpen: () => void;
  url: string | null;
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
}): FileDocumentPdfPreview | null {
  const { attachmentStorageKeyBySlotId, attachments, blobStore, fileViewer } =
    params;
  const candidate = useMemo(
    () =>
      resolveFileDocumentPdfPreview(attachments, attachmentStorageKeyBySlotId),
    [attachmentStorageKeyBySlotId, attachments],
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const generationRef = useRef(0);
  const objectUrlRef = useRef<string | null>(null);
  const openingRef = useRef(false);

  useEffect(() => {
    generationRef.current += 1;
    setError(null);
    setLoading(false);
    setUrl(null);
    openingRef.current = false;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    return () => {
      generationRef.current += 1;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [candidate?.storageKey]);

  const onOpen = useCallback(() => {
    if (!candidate || openingRef.current || objectUrlRef.current) {
      return;
    }

    openingRef.current = true;
    const generation = generationRef.current;
    setError(null);
    setLoading(true);
    void blobStore
      .readBytes(candidate.storageKey)
      .then(async (bytes) => {
        if (!bytes) {
          throw new Error("PDF bytes are not available locally.");
        }
        if (generation !== generationRef.current) {
          return;
        }
        if (fileViewer) {
          await fileViewer.viewFile({
            data: bytes,
            fileName: candidate.attachment.name,
            mimeType: candidate.attachment.mimeType,
          });
          return;
        }
        const nextUrl = URL.createObjectURL(
          new Blob([bytes], { type: "application/pdf" }),
        );
        objectUrlRef.current = nextUrl;
        setUrl(nextUrl);
      })
      .catch((openError: unknown) => {
        if (generation === generationRef.current) {
          console.error("Failed to open PDF preview:", openError);
          setError("Couldn't open this PDF. You can still download it.");
        }
      })
      .finally(() => {
        if (generation === generationRef.current) {
          openingRef.current = false;
          setLoading(false);
        }
      });
  }, [blobStore, candidate, fileViewer]);

  return candidate
    ? {
        ...candidate,
        error,
        loading,
        native: fileViewer !== null,
        onOpen,
        url,
      }
    : null;
}

export function FileDocumentPdfPreviewPanel(params: {
  preview: FileDocumentPdfPreview;
}) {
  const { attachment, error, loading, native, onOpen, url } = params.preview;

  return (
    <section className="file-document-preview" aria-label="PDF preview">
      <div className="file-document-preview-frame">
        {url ? (
          <object
            aria-label={attachment.name}
            className="file-document-pdf-preview"
            data={url}
            type="application/pdf"
          >
            <span>
              This browser couldn't display the PDF. Use Download instead.
            </span>
          </object>
        ) : (
          <div className="file-document-pdf-prompt">
            <FilePdfIcon aria-hidden size={48} />
            <strong>{attachment.name}</strong>
            <span>
              {native
                ? "Opens in your device's PDF viewer."
                : "Uses your browser's built-in PDF viewer."}
            </span>
            <MiniAppButton disabled={loading} onClick={onOpen}>
              {loading ? "Opening..." : "View PDF"}
            </MiniAppButton>
            {error ? (
              <MiniAppStatus as="span" tone="error">
                {error}
              </MiniAppStatus>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
