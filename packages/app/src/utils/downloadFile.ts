import type { BlobBytes } from "@tearleads/client-sdk";

interface DownloadFileInput {
  fileName: string;
  mimeType?: string | null | undefined;
  parts: BlobPart[];
}

function downloadFile(input: DownloadFileInput): void {
  const blob = new Blob(input.parts, {
    type: input.mimeType ?? "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
  const anchor = document.createElement("a");
  anchor.download = input.fileName;
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Revoke on a delay so the click's download navigation keeps the URL alive.
    setTimeout(() => revokeObjectUrl(url), 1000);
  }
}

export function downloadBytesAsFile(input: {
  bytes: BlobBytes;
  fileName: string;
  mimeType?: string | null | undefined;
}): void {
  downloadFile({
    fileName: input.fileName,
    mimeType: input.mimeType,
    parts: [input.bytes],
  });
}

export function downloadTextAsFile(input: {
  fileName: string;
  mimeType: string;
  text: string;
}): void {
  downloadFile({
    fileName: input.fileName,
    mimeType: input.mimeType,
    parts: [input.text],
  });
}
