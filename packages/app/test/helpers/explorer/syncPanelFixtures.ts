import type {
  ContainerNode,
  DomainSyncSnapshot,
  PendingWriteQueueItem,
  PendingWriteQueueOperation,
  SyncLaneSnapshot,
} from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";

export const CREATED_AT = "2026-07-16T12:00:00.000Z";

export function operation(
  overrides: Partial<PendingWriteQueueOperation> = {},
): PendingWriteQueueOperation {
  return {
    byteLength: 0,
    count: 1,
    createdAt: CREATED_AT,
    kind: "update",
    lastAttemptedAt: null,
    lastError: null,
    status: "pending",
    targetContainerId: null,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

export function item(
  overrides: Partial<PendingWriteQueueItem> = {},
): PendingWriteQueueItem {
  return {
    containerId: "documents-container",
    createdAt: CREATED_AT,
    localId: "document-local-id",
    name: "Offline note",
    namespace: null,
    objectKind: "document",
    operations: [operation()],
    organizationId: "personal-org",
    remoteId: "document-remote-id",
    status: "pending",
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

export const ARCHIVE_NODE = {
  id: "archive-container",
  kind: "container",
  name: "Archive",
  organizationId: "custom-org",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
} satisfies ContainerNode;

export const updatedAt = "2026-06-15T12:00:00.000Z";

export function createSnapshot(
  lanes: ReadonlyArray<SyncLaneSnapshot>,
): DomainSyncSnapshot {
  return {
    hasPendingWork: lanes.some((lane) => lane.requested || lane.running),
    lanes,
    pumpActive: lanes.some((lane) => lane.running),
    updatedAt,
  };
}

// The compact list keys off `useRoutedLayoutTier`, which reads the
// `(min-width: 760px)` media query. Force it to a phone-tier miss and leave the
// stub installed until the returned restore runs, so later interactions and
// async re-renders keep resolving to the compact layout.
export function stubPhoneMatchMedia(): () => void {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = originalMatchMedia;
  };
}
