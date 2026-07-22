/**
 * Platform capability for the app's "download" action — handing a file's bytes
 * to wherever the running platform surfaces saved files.
 *
 * The web shell has a browser download destination, so its default
 * implementation clicks a hidden `<a download>` pointed at an object URL. The
 * native WebView shells do NOT: a Capacitor WKWebView / Android System WebView
 * and Electrobun's desktop WKWebView both treat that anchor click as a silent
 * no-op, which is why downloads appear "broken" there. Each of those shells
 * injects its own {@link FileSaver} — Capacitor writes the bytes and opens the
 * native share sheet; Electrobun writes to the user's Downloads folder — so the
 * shared app can trigger a download without assuming the browser anchor works.
 *
 * The interface lives here (React-free, like the other capability contracts) so
 * `AppHostConfig` can carry a factory for it and every shell can implement it;
 * the default browser implementation lives in the app package next to the DOM
 * code it depends on.
 */

/** A file the user asked to save, plus the metadata a platform needs for it. */
export interface SaveFileRequest {
  /** Suggested file name including its extension, e.g. `"backup.json"`. */
  readonly fileName: string;
  /**
   * The file's bytes. Backed by a plain `ArrayBuffer` (not a `SharedArrayBuffer`)
   * so the bytes can go straight into a `Blob` / `fetch` body / native write —
   * the same shape as the SDK's {@link BlobBytes}.
   */
  readonly data: Uint8Array<ArrayBuffer>;
  /**
   * MIME type. Platforms that need one (the web anchor's blob, the share sheet)
   * fall back to `application/octet-stream` when it is absent.
   */
  readonly mimeType?: string | null | undefined;
}

export interface FileSaver {
  /**
   * Saves the file. Resolves once the platform has taken ownership of the bytes
   * (download started, file written, share sheet completed). A user dismissing
   * a native save/share sheet is treated as a normal no-op — it resolves rather
   * than rejecting — so callers need not distinguish cancellation from success.
   * Rejects only on a genuine failure to write or hand off the file.
   */
  saveFile(request: SaveFileRequest): Promise<void>;
}
