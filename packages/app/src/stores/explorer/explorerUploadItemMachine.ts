/**
 * One file's upload, from selection to a confirmed remote copy.
 *
 * - `queued`: waiting behind earlier files or selections.
 * - `importing`: being ingested into a local document.
 * - `imported`: stored locally as `localId` and waiting to sync. The Uploads
 *   view refines it with the document's sync lane, and `storageKeys` name its
 *   attachment blobs so the view can show their transferred bytes.
 * - `uploaded`: the SDK confirmed the document synced, with nothing pending.
 * - `removed`: the document was deleted before its upload was confirmed.
 * - `failed`: the file or its selection failed; `error` says why.
 * - `cancelled`: the user, or the view's teardown, stopped it first.
 */
export type ExplorerUploadItemStatus =
  | "queued"
  | "importing"
  | "imported"
  | "uploaded"
  | "removed"
  | "failed"
  | "cancelled";

export interface ExplorerUploadItem {
  containerId: string;
  error: string | null;
  fileName: string;
  fileSize: number;
  id: string;
  localId: string | null;
  status: ExplorerUploadItemStatus;
  storageKeys: ReadonlyArray<string>;
}

export type ExplorerUploadItemEvent =
  | { readonly type: "import-started" }
  | {
      readonly localId: string;
      readonly storageKeys: ReadonlyArray<string>;
      readonly type: "imported";
    }
  /**
   * One file failed. It may already be imported: a summary read after the
   * import can still fail the file, while its durable document syncs.
   */
  | { readonly error: string; readonly type: "file-failed" }
  /** The whole selection was refused before this file was imported. */
  | { readonly error: string; readonly type: "selection-failed" }
  | { readonly type: "cancelled" }
  | { readonly type: "upload-confirmed" }
  /** The SDK no longer has the imported file's document to confirm. */
  | { readonly type: "document-missing" };

export function isOutstandingUploadItem(item: ExplorerUploadItem): boolean {
  return item.status === "queued" || item.status === "importing";
}

/**
 * Pure transition; returns the same reference for ignored events. `uploaded`,
 * `removed`, `failed`, and `cancelled` are terminal.
 *
 * | state \ event    | queued    | importing | imported           |
 * | ---------------- | --------- | --------- | ------------------ |
 * | import-started   | importing | (same)    | (same)             |
 * | imported         | imported  | imported  | (same)             |
 * | file-failed      | failed    | failed    | failed             |
 * | selection-failed | failed    | failed    | (same)             |
 * | cancelled        | cancelled | cancelled | (same)             |
 * | upload-confirmed | (same)    | (same)    | uploaded           |
 * | document-missing | (same)    | (same)    | removed            |
 */
export function transitionExplorerUploadItem(
  item: ExplorerUploadItem,
  event: ExplorerUploadItemEvent,
): ExplorerUploadItem {
  switch (event.type) {
    case "import-started":
      return item.status === "queued" ? { ...item, status: "importing" } : item;
    case "imported":
      return isOutstandingUploadItem(item)
        ? {
            ...item,
            localId: event.localId,
            status: "imported",
            storageKeys: event.storageKeys,
          }
        : item;
    case "file-failed":
      return isOutstandingUploadItem(item) || item.status === "imported"
        ? { ...item, error: event.error, status: "failed" }
        : item;
    case "selection-failed":
      return isOutstandingUploadItem(item)
        ? { ...item, error: event.error, status: "failed" }
        : item;
    case "cancelled":
      return isOutstandingUploadItem(item)
        ? { ...item, error: null, status: "cancelled" }
        : item;
    case "upload-confirmed":
      return settleImported(item, "uploaded");
    case "document-missing":
      return settleImported(item, "removed");
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/** Only an imported file awaits the SDK's verdict on its upload. */
function settleImported(
  item: ExplorerUploadItem,
  status: "uploaded" | "removed",
): ExplorerUploadItem {
  return item.status === "imported" ? { ...item, status } : item;
}
