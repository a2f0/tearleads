import type {
  ContainerContents,
  DocumentAttributionRangesInput,
  DocumentAttributionRangesPage,
  DocumentInfo,
  StoredDocumentKind,
} from "@symcrypt/client-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type RuntimeSnapshot,
  useSymCrypt,
} from "../../providers/sdk/SymCryptProvider";

export function documentInfoRefreshKey(
  events: readonly unknown[],
  documentId: string | null | undefined,
  documentUpdatedAt: string | null | undefined = null,
  syncCompletionRevision = 0,
): string {
  if (!documentId) {
    return "";
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || typeof event !== "object") {
      continue;
    }
    const eventDocumentId = Reflect.get(event, "documentId");
    const eventType = Reflect.get(event, "type");
    if (
      eventDocumentId === documentId &&
      (eventType === "document_update_created" ||
        eventType === "document_mutation_created")
    ) {
      const eventId = Reflect.get(event, "id");
      const eventKey = typeof eventId === "string" ? eventId : String(index);
      const baseKey = documentUpdatedAt
        ? `${documentUpdatedAt}\u0000${eventKey}`
        : eventKey;
      return syncCompletionRevision > 0
        ? `${baseKey}\u0000sync:${syncCompletionRevision}`
        : baseKey;
    }
  }

  const baseKey = documentUpdatedAt ?? "";
  return syncCompletionRevision > 0
    ? `${baseKey}\u0000sync:${syncCompletionRevision}`
    : baseKey;
}

interface SyncCompletionStore {
  getSnapshot: () => { readonly syncing: boolean };
  subscribe: (listener: () => void) => () => void;
}

export function subscribeDocumentSyncCompletions(
  store: SyncCompletionStore,
  onComplete: () => void,
): () => void {
  let wasSyncing = store.getSnapshot().syncing;
  return store.subscribe(() => {
    const syncing = store.getSnapshot().syncing;
    if (wasSyncing && !syncing) {
      onComplete();
    }
    wasSyncing = syncing;
  });
}

function useDocumentSyncCompletionRevision(input: {
  containerContents: ContainerContents;
  documentContainerId: string | null | undefined;
  documentId: string | null | undefined;
  documentKind: StoredDocumentKind | undefined;
  documentLocalId: string | null | undefined;
}): number {
  const [revision, setRevision] = useState(0);
  const store = useMemo(() => {
    if (!input.documentContainerId || !input.documentLocalId) {
      return null;
    }
    return input.containerContents.documentLinks().openDocument({
      containerId: input.documentContainerId,
      documentId: input.documentId,
      initialDocumentKind: input.documentKind,
      localId: input.documentLocalId,
    });
  }, [
    input.containerContents,
    input.documentContainerId,
    input.documentId,
    input.documentKind,
    input.documentLocalId,
  ]);

  useEffect(() => {
    if (!store) {
      return;
    }
    return subscribeDocumentSyncCompletions(store, () => {
      setRevision((current) => current + 1);
    });
  }, [store]);
  return revision;
}

export function useExplorerDocumentInfoLoader(input: {
  readonly appData: Pick<RuntimeSnapshot, "auth" | "state">;
  readonly documentContainerId?: string | null | undefined;
  readonly documentId?: string | null | undefined;
  readonly documentKind?: StoredDocumentKind | undefined;
  readonly documentLocalId?: string | null | undefined;
  readonly documentUpdatedAt?: string | null | undefined;
}): (localId: string) => Promise<DocumentInfo> {
  const {
    appData,
    documentContainerId,
    documentId,
    documentKind,
    documentLocalId,
    documentUpdatedAt,
  } = input;
  const { containerContents } = useSymCrypt();
  const isAuthenticated = appData.auth.isAuthenticated;
  const online = appData.state.online;
  const syncCompletionRevision = useDocumentSyncCompletionRevision({
    containerContents,
    documentContainerId,
    documentId,
    documentKind,
    documentLocalId,
  });
  const refreshKey = documentInfoRefreshKey(
    appData.state.events,
    documentId,
    documentUpdatedAt,
    syncCompletionRevision,
  );

  return useCallback(
    (localId: string) => {
      // The key deliberately participates in callback identity so the mounted
      // Info panel refreshes for this document's events, not every runtime event.
      void refreshKey;
      return containerContents.loadDocumentInfo({
        attributionRequestKey: refreshKey,
        localId,
        remoteInfoMode: isAuthenticated && online ? "if-synced" : "never",
      });
    },
    [containerContents, isAuthenticated, online, refreshKey],
  );
}

export type ExplorerDocumentAttributionRangesLoader = (
  input: DocumentAttributionRangesInput,
) => Promise<DocumentAttributionRangesPage>;

export function useExplorerDocumentAttributionRangesLoader(): ExplorerDocumentAttributionRangesLoader {
  const { containerContents } = useSymCrypt();

  return useCallback(
    (input: DocumentAttributionRangesInput) =>
      containerContents.loadDocumentAttributionRanges(input),
    [containerContents],
  );
}
