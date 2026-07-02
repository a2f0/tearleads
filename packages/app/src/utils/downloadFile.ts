import type { BlobBytes } from "@tearleads/client-sdk";

// Trigger a browser "save file" for in-memory bytes using the anchor-download
// idiom shared by downloadKeyPackageFile / downloadBackupFile. Kept generic so
// any mini-app can hand it bytes + a name without re-deriving the plumbing.
export function downloadBytesAsFile(input: {
  bytes: BlobBytes;
  fileName: string;
  mimeType?: string | null | undefined;
}): void {
  const blob = new Blob([input.bytes], {
    type: input.mimeType ?? "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
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
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
