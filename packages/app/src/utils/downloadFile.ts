import type {
  BlobBytes,
  FileSaver,
  SaveFileRequest,
} from "@tearleads/client-sdk";

const TEXT_ENCODER = new TextEncoder();

/**
 * The default {@link FileSaver}: build an object URL for the bytes and click a
 * hidden `<a download>` — the browser's native download. The native WebView
 * shells (Capacitor, Electrobun) replace this with a platform saver injected
 * through the host config, because a WebView has no browser download
 * destination and this anchor click is a silent no-op there.
 *
 * Touches no DOM at construction (only inside `saveFile`), so it is safe to
 * build eagerly as the file-saver context's default value.
 */
export function createBrowserFileSaver(): FileSaver {
  return {
    saveFile(request: SaveFileRequest): Promise<void> {
      const blob = new Blob([request.data], {
        type: request.mimeType ?? "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.download = request.fileName;
      anchor.href = url;
      anchor.rel = "noopener";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        // Revoke on a delay so the click's download navigation keeps the URL alive.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      return Promise.resolve();
    },
  };
}

export function downloadBytesAsFile(
  fileSaver: FileSaver,
  input: {
    bytes: BlobBytes;
    fileName: string;
    mimeType?: string | null | undefined;
  },
): Promise<void> {
  return fileSaver.saveFile({
    data: input.bytes,
    fileName: input.fileName,
    mimeType: input.mimeType,
  });
}

export function downloadTextAsFile(
  fileSaver: FileSaver,
  input: {
    fileName: string;
    mimeType: string;
    text: string;
  },
): Promise<void> {
  return fileSaver.saveFile({
    data: TEXT_ENCODER.encode(input.text),
    fileName: input.fileName,
    mimeType: input.mimeType,
  });
}
