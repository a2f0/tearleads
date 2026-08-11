import type { BlobInfo, BlobStore } from "@tearleads/client-sdk";
import { useEffect, useState } from "react";
import {
  isAutomaticBlobPreviewAllowed,
  isImageDocumentAttachmentBlob,
} from "../../../../document-types/shared/documentAttachmentUtils";
import { unknownErrorMessage } from "../../../../utils/unknownErrorMessage";

const BLOB_TEXT_PREVIEW_LIMIT = 64 * 1024;

// The detail screen's read of a blob's bytes: a text preview for text-ish MIME
// types, an object URL for anything the browser can render inline, and the
// list's thumbnails. Kept apart from the list state, which only ever reads
// metadata.
export type BlobPreviewState =
  | { status: "idle"; text: null; truncated: false; url: null }
  | { status: "loading"; text: null; truncated: false; url: null }
  | { status: "missing"; text: null; truncated: false; url: null }
  | { status: "error"; error: string; text: null; truncated: false; url: null }
  | {
      status: "ready";
      byteLength: number;
      text: string | null;
      truncated: boolean;
      url: string | null;
    };

function isTextMimeType(mimeType: string | null): boolean {
  return (
    mimeType?.startsWith("text/") === true ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/javascript" ||
    mimeType === "image/svg+xml"
  );
}

function decodePreviewText(bytes: Uint8Array<ArrayBuffer>): {
  text: string;
  truncated: boolean;
} {
  const truncated = bytes.byteLength > BLOB_TEXT_PREVIEW_LIMIT;
  // subarray returns a view rather than copying; we only read it to decode.
  const previewBytes = truncated
    ? bytes.subarray(0, BLOB_TEXT_PREVIEW_LIMIT)
    : bytes;

  return {
    text: new TextDecoder().decode(previewBytes),
    truncated,
  };
}

async function readBlobPreview(input: {
  blob: BlobInfo;
  blobStore: BlobStore;
}): Promise<{ objectUrl: string | null; state: BlobPreviewState }> {
  if (!isAutomaticBlobPreviewAllowed(input.blob)) {
    return {
      objectUrl: null,
      state: {
        byteLength: input.blob.byteLength,
        status: "ready",
        text: null,
        truncated: false,
        url: null,
      },
    };
  }

  const bytes = await input.blobStore.readBytes(input.blob.storageKey);
  if (!bytes) {
    return {
      objectUrl: null,
      state: {
        status: "missing",
        text: null,
        truncated: false,
        url: null,
      },
    };
  }

  const mimeType = input.blob.mimeType ?? "application/octet-stream";
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));

  try {
    const textPreview = isTextMimeType(input.blob.mimeType)
      ? decodePreviewText(bytes)
      : null;

    return {
      objectUrl,
      state: {
        byteLength: bytes.byteLength,
        status: "ready",
        text: textPreview?.text ?? null,
        truncated: textPreview?.truncated ?? false,
        url: objectUrl,
      },
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

export function useBlobPreview(params: {
  blob: BlobInfo | null;
  blobStore: BlobStore;
}): BlobPreviewState {
  const { blob, blobStore } = params;
  const [state, setState] = useState<BlobPreviewState>({
    status: "idle",
    text: null,
    truncated: false,
    url: null,
  });

  useEffect(() => {
    if (!blob) {
      setState({
        status: "idle",
        text: null,
        truncated: false,
        url: null,
      });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setState({
      status: "loading",
      text: null,
      truncated: false,
      url: null,
    });

    void readBlobPreview({ blob, blobStore })
      .then((preview) => {
        if (cancelled) {
          if (preview.objectUrl) {
            URL.revokeObjectURL(preview.objectUrl);
          }
          return;
        }

        objectUrl = preview.objectUrl;
        setState(preview.state);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            error: unknownErrorMessage(error),
            status: "error",
            text: null,
            truncated: false,
            url: null,
          });
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [blob, blobStore]);

  return state;
}

// Read a small image blob into an object URL for a compact table thumbnail.
// Large, non-image, and non-browser blobs use the file-type icon instead.
export function useBlobThumbnailUrl(params: {
  blob: BlobInfo;
  blobStore: BlobStore;
}): string | null {
  const { blobStore } = params;
  const isImage = isImageDocumentAttachmentBlob(params.blob);
  const isPreviewAllowed = isAutomaticBlobPreviewAllowed(params.blob);
  const { storageKey } = params.blob;
  const mimeType = params.blob.mimeType ?? "application/octet-stream";
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage || !isPreviewAllowed) {
      setUrl(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const bytes = await blobStore.readBytes(storageKey);
        if (cancelled || !bytes) {
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        setUrl(objectUrl);
      } catch {
        // A thumbnail is best-effort; a failed read just falls back to the icon.
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      setUrl(null);
    };
  }, [blobStore, isImage, isPreviewAllowed, mimeType, storageKey]);

  return url;
}
