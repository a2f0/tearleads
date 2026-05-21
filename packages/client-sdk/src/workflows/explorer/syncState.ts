export type ExplorerObjectSyncStatus =
  | "synced"
  | "local-only"
  | "pending"
  | "error";

export interface ExplorerObjectSyncState {
  lastError: string | null;
  pendingAttachmentBytes: number;
  pendingAttachmentCount: number;
  pendingUpdateCount: number;
  status: ExplorerObjectSyncStatus;
}

export const syncedExplorerObjectSyncState: ExplorerObjectSyncState = {
  lastError: null,
  pendingAttachmentBytes: 0,
  pendingAttachmentCount: 0,
  pendingUpdateCount: 0,
  status: "synced",
};

export function createExplorerObjectSyncState(input: {
  lastError?: string | null | undefined;
  localOnly?: boolean | undefined;
  pendingAttachmentBytes?: number | null | undefined;
  pendingAttachmentCount?: number | null | undefined;
  pendingUpdateCount?: number | null | undefined;
}): ExplorerObjectSyncState {
  const lastError = input.lastError ?? null;
  const pendingAttachmentBytes = input.pendingAttachmentBytes ?? 0;
  const pendingAttachmentCount = input.pendingAttachmentCount ?? 0;
  const pendingUpdateCount = input.pendingUpdateCount ?? 0;

  if (
    !lastError &&
    !input.localOnly &&
    pendingAttachmentBytes === 0 &&
    pendingAttachmentCount === 0 &&
    pendingUpdateCount === 0
  ) {
    return syncedExplorerObjectSyncState;
  }

  return {
    lastError,
    pendingAttachmentBytes,
    pendingAttachmentCount,
    pendingUpdateCount,
    status: lastError ? "error" : input.localOnly ? "local-only" : "pending",
  };
}
