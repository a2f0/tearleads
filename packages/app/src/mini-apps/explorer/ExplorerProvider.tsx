import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  decryptLoroUpdate,
  encodeVersionVector,
  exportAllUpdates,
  exportUpdatesSince,
  importUpdates,
} from "@tearleads/loro";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useAppData } from "../../data/AppDataProvider";
import type { BlobStore } from "../../data/blob-store";
import {
  createContainerMetadataDocument,
  createInitializedContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containerMetadataDocument";
import type { ContainerRecord } from "../../data/containerPersistence";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../data/documentPersistence";
import {
  createPendingUpdateFields,
  encryptPendingUpdates,
  getLocalRecipientPublicKeys,
  isDocumentUpdateCreatedEvent,
  resolveRecipientPublicKeys,
} from "../../data/documentSync";
import type { ExecSql } from "../../data/sqlSchema";
import {
  primeNotesStore,
  requestDomainNotesSync,
} from "../notes/NotesProvider";
import { sqlNotesPersistence } from "../notes/notesPersistence";
import {
  type ExplorerPersistence,
  sqlExplorerPersistence,
} from "./explorerPersistence";
import type { ContainerNode } from "./types";

type ContainerMetadataDocument = Awaited<
  ReturnType<typeof createContainerMetadataDocument>
>;
type ExplorerAppData = ReturnType<typeof useAppData>;

interface ExplorerContextValue {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
  refresh: () => Promise<boolean>;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}

interface ExplorerSnapshot {
  nodes: ReadonlyArray<ContainerNode>;
  ready: boolean;
}

interface ExplorerRuntime {
  apiClient: Pick<
    ExplorerAppData["apiClient"],
    | "commitDocumentChange"
    | "createContainer"
    | "createDocument"
    | "getBlob"
    | "listContainers"
    | "listDocumentAttachments"
    | "shareContainer"
    | "stageBlob"
    | "syncDocument"
  >;
  blobStore: BlobStore;
  dbStatus: ExplorerAppData["dbStatus"];
  domainScope: ExplorerAppData["domainScope"];
  encapsulationKeyPair: ExplorerAppData["encapsulationKeyPair"];
  events: ExplorerAppData["events"];
  execSql: ExecSql;
  isAuthenticated: ExplorerAppData["isAuthenticated"];
  log: ExplorerAppData["log"];
  online: ExplorerAppData["online"];
}

interface ExplorerStore {
  createChild: (
    parentId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  deleteContainer: (containerId: string) => Promise<boolean>;
  refresh: () => Promise<boolean>;
  renameContainer: (
    containerId: string,
    name: string,
  ) => Promise<ContainerNode | null>;
  shareWithUser: (containerId: string, userId: string) => Promise<boolean>;
  getSnapshot: () => ExplorerSnapshot;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: ExplorerRuntime) => void;
}

interface ContainerState {
  container: ContainerRecord;
  doc: ContainerMetadataDocument;
  recipientPublicKeys: Uint8Array[];
  record: DocumentRecord;
}

const explorerStoresByScope = new WeakMap<object, ExplorerStore>();
const ExplorerContext = createContext<ExplorerStore | null>(null);

function getFallbackContainerName(parentId: string | null): string {
  return parentId === null ? "/" : "Untitled";
}

function toContainerNode(container: ContainerRecord): ContainerNode {
  return {
    id: container.id,
    kind: "container",
    name: container.name,
    organizationId: container.organizationId,
    parentId: container.parentId,
  };
}

function isContainerInSubtree(
  containersById: ReadonlyMap<string, ContainerState>,
  containerId: string,
  rootContainerId: string,
): boolean {
  let currentContainerId: string | null = containerId;

  while (currentContainerId !== null) {
    if (currentContainerId === rootContainerId) {
      return true;
    }

    const currentContainerState = containersById.get(currentContainerId);
    currentContainerId = currentContainerState?.container.parentId ?? null;
  }

  return false;
}

function getSnapshotNodes(
  containersById: ReadonlyMap<string, ContainerState>,
): ReadonlyArray<ContainerNode> {
  return Array.from(containersById.values(), (containerState) =>
    toContainerNode(containerState.container),
  ).sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    }),
  );
}

export function createExplorerStore(
  initialRuntime: ExplorerRuntime,
  persistence: ExplorerPersistence = sqlExplorerPersistence,
): ExplorerStore {
  let runtime = initialRuntime;
  let containersById = new Map<string, ContainerState>();
  let initialized = false;
  let initializePromise: Promise<void> | null = null;
  let syncPromise: Promise<void> | null = null;
  let remoteHydrationPromise: Promise<void> | null = null;
  let syncRequested = false;
  let writeChain = Promise.resolve<ContainerNode | null>(null);
  let lastEventCount = 0;
  const listeners = new Set<() => void>();

  let snapshot: ExplorerSnapshot = {
    nodes: [],
    ready: false,
  };

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }

  function setSnapshot(next: ExplorerSnapshot) {
    if (next.ready === snapshot.ready && next.nodes === snapshot.nodes) {
      return;
    }

    snapshot = next;
    emit();
  }

  function updateSnapshot() {
    setSnapshot({
      nodes: getSnapshotNodes(containersById),
      ready: true,
    });
  }

  function resetStore() {
    containersById = new Map();
    initialized = false;
    initializePromise = null;
    syncPromise = null;
    remoteHydrationPromise = null;
    syncRequested = false;
    writeChain = Promise.resolve<ContainerNode | null>(null);
    setSnapshot({
      nodes: [],
      ready: false,
    });
  }

  async function persistContainerState(
    containerState: ContainerState,
    patch: Partial<{
      accessEpoch: number;
      documentId: string | null;
      icon: string | null;
      metadataDocumentId: string | null;
      loroSnapshot: string;
      name: string;
      organizationId: string;
      parentId: string | null;
    }> = {},
    updateView = true,
  ): Promise<DocumentRecord> {
    const metadata = readContainerMetadataValue(
      containerState.doc,
      getFallbackContainerName(containerState.container.parentId),
    );
    const nextContainer: ContainerRecord = {
      ...containerState.container,
      organizationId:
        patch.organizationId ?? containerState.container.organizationId,
      parentId: patch.parentId ?? containerState.container.parentId,
      metadataDocumentId:
        patch.metadataDocumentId ??
        patch.documentId ??
        containerState.container.metadataDocumentId,
      name: patch.name ?? metadata.name,
      icon: patch.icon ?? metadata.icon,
    };
    const nextRecord: DocumentRecord = {
      id: containerState.container.id,
      documentId: patch.documentId ?? containerState.record.documentId,
      loroSnapshot:
        patch.loroSnapshot ??
        bytesToBase64(exportAllUpdates(containerState.doc)),
      accessEpoch: patch.accessEpoch ?? containerState.record.accessEpoch,
    };

    await persistence.saveContainer(runtime.execSql, nextContainer, nextRecord);
    containerState.container = nextContainer;
    containerState.record = nextRecord;
    if (updateView) {
      updateSnapshot();
    }
    return nextRecord;
  }

  async function primeNotesForSharedSubtree(rootContainerId: string) {
    const sharedContainerIds = new Set(
      Array.from(containersById.values())
        .filter((containerState) =>
          isContainerInSubtree(
            containersById,
            containerState.container.id,
            rootContainerId,
          ),
        )
        .map((containerState) => containerState.container.id),
    );

    if (sharedContainerIds.size === 0) {
      return;
    }

    await sqlNotesPersistence.ensureSchema(runtime.execSql);
    const noteSummaries = await sqlNotesPersistence.listNotes(runtime.execSql);

    for (const noteSummary of noteSummaries) {
      if (
        !noteSummary.containerId ||
        !sharedContainerIds.has(noteSummary.containerId)
      ) {
        continue;
      }

      const notesStore = primeNotesStore(runtime.domainScope, noteSummary.id, {
        apiClient: {
          commitDocumentChange: (documentId, input) =>
            runtime.apiClient.commitDocumentChange(documentId, input),
          createDocument: (linkedContainerIds) =>
            runtime.apiClient.createDocument(linkedContainerIds),
          getBlob: (blobId) => runtime.apiClient.getBlob(blobId),
          listDocumentAttachments: (documentId) =>
            runtime.apiClient.listDocumentAttachments(documentId),
          stageBlob: (input) => runtime.apiClient.stageBlob(input),
          syncDocument: (
            documentId,
            accessEpoch,
            localVersionVector,
            outgoingUpdates,
          ) =>
            runtime.apiClient.syncDocument(
              documentId,
              accessEpoch,
              localVersionVector,
              outgoingUpdates,
            ),
        },
        blobStore: runtime.blobStore,
        containerId: noteSummary.containerId,
        dbStatus: runtime.dbStatus,
        domainScope: runtime.domainScope,
        encapsulationKeyPair: runtime.encapsulationKeyPair,
        events: runtime.events,
        execSql: runtime.execSql,
        isAuthenticated: runtime.isAuthenticated,
        log: runtime.log,
        online: runtime.online,
      });
      notesStore.requestSync();
    }
  }

  async function listPendingUpdates(
    containerId: string,
  ): Promise<PendingUpdateRecord[]> {
    return persistence.listPendingUpdates(runtime.execSql, containerId);
  }

  async function enqueuePendingUpdate(containerId: string, update: Uint8Array) {
    const pendingUpdateFields = createPendingUpdateFields(update);
    if (!pendingUpdateFields) {
      return;
    }

    await persistence.enqueuePendingUpdate(runtime.execSql, {
      containerId,
      ...pendingUpdateFields,
    });
  }

  async function deletePendingUpdate(id: string) {
    await persistence.deletePendingUpdate(runtime.execSql, id);
  }

  async function decryptMetadataUpdates(
    encryptedUpdates: ReadonlyArray<{ encryptedData: string }>,
    secretKey: Uint8Array,
  ): Promise<Uint8Array[]> {
    const decryptedUpdates: Uint8Array[] = [];
    let skippedUpdateCount = 0;

    for (const update of encryptedUpdates) {
      try {
        decryptedUpdates.push(
          await decryptLoroUpdate(update.encryptedData, secretKey),
        );
      } catch {
        skippedUpdateCount += 1;
      }
    }

    if (skippedUpdateCount > 0) {
      runtime.log(
        `Explorer: skipped ${skippedUpdateCount} undecryptable metadata update(s)`,
      );
    }

    return decryptedUpdates;
  }

  async function hydrateRemoteContainers(): Promise<void> {
    if (
      !runtime.isAuthenticated ||
      !runtime.online ||
      runtime.dbStatus !== "ready"
    ) {
      return;
    }

    const remoteContainers = await runtime.apiClient.listContainers();
    if (!remoteContainers) {
      return;
    }

    const localRecipientPublicKeys = getLocalRecipientPublicKeys(
      runtime.encapsulationKeyPair,
    );

    for (const remoteContainer of remoteContainers) {
      const existingState = containersById.get(remoteContainer.id);

      if (existingState) {
        existingState.recipientPublicKeys = resolveRecipientPublicKeys(
          remoteContainer.metadataRecipientEncapsulationPublicKeys,
          localRecipientPublicKeys,
        );
        await persistContainerState(
          existingState,
          {
            accessEpoch: remoteContainer.metadataAccessEpoch,
            documentId: remoteContainer.metadataDocumentId,
            metadataDocumentId: remoteContainer.metadataDocumentId,
            organizationId: remoteContainer.organizationId,
            parentId: remoteContainer.parentId,
          },
          false,
        );
        continue;
      }

      const doc = await createContainerMetadataDocument(remoteContainer.id);
      const initialSnapshot = bytesToBase64(exportAllUpdates(doc));
      const containerState: ContainerState = {
        container: {
          id: remoteContainer.id,
          organizationId: remoteContainer.organizationId,
          parentId: remoteContainer.parentId,
          metadataDocumentId: remoteContainer.metadataDocumentId,
          name: getFallbackContainerName(remoteContainer.parentId),
          icon: null,
        },
        doc,
        recipientPublicKeys: resolveRecipientPublicKeys(
          remoteContainer.metadataRecipientEncapsulationPublicKeys,
          localRecipientPublicKeys,
        ),
        record: {
          accessEpoch: remoteContainer.metadataAccessEpoch,
          documentId: remoteContainer.metadataDocumentId,
          id: remoteContainer.id,
          loroSnapshot: initialSnapshot,
        },
      };

      await persistence.saveContainer(
        runtime.execSql,
        containerState.container,
        containerState.record,
      );
      containersById.set(remoteContainer.id, containerState);
    }

    if (remoteContainers.length > 0) {
      updateSnapshot();
      runtime.log(
        `Explorer: hydrated ${remoteContainers.length} remote container(s)`,
      );
    }
  }

  function requestRemoteHydration(): Promise<void> {
    if (remoteHydrationPromise) {
      return remoteHydrationPromise;
    }

    remoteHydrationPromise = hydrateRemoteContainers()
      .catch((error: unknown) => {
        if (
          error instanceof Error &&
          error.message === "Database worker client has been destroyed."
        ) {
          return;
        }

        throw error;
      })
      .finally(() => {
        remoteHydrationPromise = null;

        if (snapshot.ready && runtime.isAuthenticated && runtime.online) {
          scheduleSync();
        }
      });

    return remoteHydrationPromise;
  }

  function scheduleRemoteHydration() {
    void requestRemoteHydration();
  }

  async function initialize() {
    if (runtime.dbStatus !== "ready") {
      return;
    }

    await persistence.ensureSchema(runtime.execSql);
    const storedContainers = await persistence.loadContainers(runtime.execSql);

    for (const storedContainer of storedContainers) {
      const { container } = storedContainer;
      const doc = await createContainerMetadataDocument(container.id);
      let nextContainer = container;
      let nextRecord = storedContainer.record;

      if (nextRecord?.loroSnapshot) {
        importUpdates(doc, [base64ToBytes(nextRecord.loroSnapshot)]);
        const metadata = readContainerMetadataValue(
          doc,
          getFallbackContainerName(container.parentId),
        );
        nextContainer = {
          ...container,
          icon: metadata.icon,
          name: metadata.name,
        };
        await persistence.saveContainer(
          runtime.execSql,
          nextContainer,
          nextRecord,
        );
      } else {
        writeContainerMetadataValue(doc, {
          icon: container.icon,
          name: container.name,
        });
        const initialUpdate = exportAllUpdates(doc);
        nextRecord = {
          accessEpoch: 1,
          documentId: container.metadataDocumentId,
          id: container.id,
          loroSnapshot: bytesToBase64(initialUpdate),
        };
        await persistence.saveContainer(
          runtime.execSql,
          nextContainer,
          nextRecord,
        );

        if (!container.metadataDocumentId) {
          await enqueuePendingUpdate(container.id, initialUpdate);
        }
      }

      containersById.set(container.id, {
        container: nextContainer,
        doc,
        recipientPublicKeys: getLocalRecipientPublicKeys(
          runtime.encapsulationKeyPair,
        ),
        record: nextRecord,
      });
    }

    initialized = true;
    initializePromise = null;
    updateSnapshot();

    runtime.log(`Explorer: loaded ${containersById.size} container(s)`);

    if (runtime.isAuthenticated && runtime.online) {
      await hydrateRemoteContainers();
    }

    if (
      containersById.size > 0 ||
      (runtime.isAuthenticated && runtime.online)
    ) {
      scheduleSync();
    }
  }

  function ensureInitialized() {
    if (initialized || initializePromise || runtime.dbStatus !== "ready") {
      return;
    }

    initializePromise = initialize().catch((error: unknown) => {
      initializePromise = null;

      if (
        error instanceof Error &&
        error.message === "Database worker client has been destroyed."
      ) {
        return;
      }

      throw error;
    });
  }

  function scheduleSync() {
    syncRequested = true;

    if (syncPromise) {
      return;
    }

    syncPromise = (async () => {
      while (syncRequested) {
        syncRequested = false;

        if (
          !snapshot.ready ||
          !runtime.online ||
          !runtime.isAuthenticated ||
          !runtime.encapsulationKeyPair
        ) {
          continue;
        }

        const encapsulationKeyPair = runtime.encapsulationKeyPair;

        if (!encapsulationKeyPair) {
          continue;
        }

        for (const containerState of Array.from(containersById.values())) {
          const pendingUpdates = await listPendingUpdates(
            containerState.container.id,
          );
          const documentId = containerState.record.documentId;

          if (!documentId) {
            continue;
          }

          const outgoingUpdates = await encryptPendingUpdates(
            pendingUpdates,
            containerState.recipientPublicKeys,
          );

          const synced = await runtime.apiClient.syncDocument(
            documentId,
            containerState.record.accessEpoch,
            encodeVersionVector(containerState.doc),
            outgoingUpdates,
          );

          if (!synced) {
            continue;
          }

          containerState.recipientPublicKeys = resolveRecipientPublicKeys(
            synced.recipientEncapsulationPublicKeys,
            getLocalRecipientPublicKeys(runtime.encapsulationKeyPair),
          );

          for (const acceptedOutgoingUpdateId of synced.acceptedOutgoingUpdateIds) {
            await deletePendingUpdate(acceptedOutgoingUpdateId);
          }

          if (synced.updates.length > 0) {
            const decryptedUpdates = await decryptMetadataUpdates(
              synced.updates,
              encapsulationKeyPair.secretKey,
            );
            if (decryptedUpdates.length > 0) {
              importUpdates(containerState.doc, decryptedUpdates);
            }
          }

          const previousAccessEpoch = containerState.record.accessEpoch;
          await persistContainerState(containerState, {
            accessEpoch: synced.currentAccessEpoch,
            documentId,
            metadataDocumentId: documentId,
          });

          if (
            pendingUpdates.length > 0 &&
            synced.currentAccessEpoch !== previousAccessEpoch
          ) {
            syncRequested = true;
          }
        }
      }

      syncPromise = null;
    })().catch((error: unknown) => {
      syncPromise = null;

      if (
        error instanceof Error &&
        error.message === "Database worker client has been destroyed."
      ) {
        return;
      }

      throw error;
    });
  }

  function handleRemoteEvents() {
    const knownDocumentIds = new Set(
      Array.from(
        containersById.values(),
        (containerState) => containerState.record.documentId,
      ).filter((documentId) => documentId !== null),
    );

    if (knownDocumentIds.size === 0) {
      lastEventCount = runtime.events.length;
      return;
    }

    const nextEvents = runtime.events.slice(lastEventCount);
    lastEventCount = runtime.events.length;

    if (
      nextEvents.some(
        (event) =>
          isDocumentUpdateCreatedEvent(event) &&
          knownDocumentIds.has(event.documentId),
      )
    ) {
      scheduleSync();
    }
  }

  return {
    createChild(parentId, name) {
      const trimmedName = name.trim();
      if (runtime.dbStatus !== "ready" || !snapshot.ready || !trimmedName) {
        return Promise.resolve(null);
      }

      writeChain = writeChain
        .catch(() => null)
        .then(async () => {
          const parentState = containersById.get(parentId);
          if (!parentState) {
            return null;
          }

          const childId = crypto.randomUUID();
          const { doc, initialUpdate } =
            await createInitializedContainerMetadataDocument(childId, {
              icon: null,
              name: trimmedName,
            });
          const initialRecord: DocumentRecord = {
            accessEpoch: 1,
            documentId: null,
            id: childId,
            loroSnapshot: bytesToBase64(initialUpdate),
          };
          let childState: ContainerState;

          if (runtime.isAuthenticated && runtime.encapsulationKeyPair) {
            const pendingUpdateFields =
              createPendingUpdateFields(initialUpdate);
            const initialMetadataUpdates = pendingUpdateFields
              ? await encryptPendingUpdates(
                  [
                    {
                      id: crypto.randomUUID(),
                      ...pendingUpdateFields,
                    },
                  ],
                  parentState.recipientPublicKeys,
                )
              : [];
            const created = await runtime.apiClient.createContainer(
              childId,
              parentState.container.id,
              initialMetadataUpdates,
            );

            if (!created) {
              return null;
            }

            childState = {
              container: {
                id: created.id,
                organizationId: created.organizationId,
                parentId: created.parentId,
                metadataDocumentId: created.metadataDocumentId,
                name: trimmedName,
                icon: null,
              },
              doc,
              recipientPublicKeys: resolveRecipientPublicKeys(
                created.metadataRecipientEncapsulationPublicKeys,
                getLocalRecipientPublicKeys(runtime.encapsulationKeyPair),
              ),
              record: {
                ...initialRecord,
                accessEpoch: created.metadataAccessEpoch,
                documentId: created.metadataDocumentId,
              },
            };
          } else {
            childState = {
              container: {
                id: childId,
                organizationId: parentState.container.organizationId,
                parentId: parentState.container.id,
                metadataDocumentId: null,
                name: trimmedName,
                icon: null,
              },
              doc,
              recipientPublicKeys: getLocalRecipientPublicKeys(
                runtime.encapsulationKeyPair,
              ),
              record: initialRecord,
            };
          }

          await persistence.saveContainer(
            runtime.execSql,
            childState.container,
            childState.record,
          );

          if (!childState.record.documentId) {
            await enqueuePendingUpdate(childState.container.id, initialUpdate);
          }

          containersById.set(childState.container.id, childState);
          updateSnapshot();
          runtime.log(`Explorer: created container "${trimmedName}"`);
          return toContainerNode(childState.container);
        });

      return writeChain;
    },

    deleteContainer(containerId) {
      if (runtime.dbStatus !== "ready" || !snapshot.ready) {
        return Promise.resolve(false);
      }

      writeChain = writeChain
        .catch(() => null)
        .then(async () => {
          const existingState = containersById.get(containerId);
          if (
            !existingState ||
            existingState.container.parentId === null ||
            Array.from(containersById.values()).some(
              (containerState) =>
                containerState.container.parentId === containerId,
            )
          ) {
            return null;
          }

          await persistence.deleteContainer(
            runtime.execSql,
            existingState.container.id,
          );
          containersById.delete(existingState.container.id);
          updateSnapshot();
          runtime.log(
            `Explorer: deleted container "${existingState.container.name}"`,
          );
          return toContainerNode(existingState.container);
        });

      return writeChain.then((deletedNode) => deletedNode !== null);
    },

    refresh() {
      if (
        runtime.dbStatus !== "ready" ||
        !initialized ||
        !runtime.isAuthenticated ||
        !runtime.online
      ) {
        return Promise.resolve(false);
      }

      return requestRemoteHydration().then(() => true);
    },

    renameContainer(containerId, name) {
      const trimmedName = name.trim();
      if (runtime.dbStatus !== "ready" || !snapshot.ready || !trimmedName) {
        return Promise.resolve(null);
      }

      writeChain = writeChain
        .catch(() => null)
        .then(async () => {
          const existingState = containersById.get(containerId);
          if (!existingState) {
            return null;
          }

          if (existingState.container.name === trimmedName) {
            return toContainerNode(existingState.container);
          }

          const previousVersion = encodeVersionVector(existingState.doc);
          writeContainerMetadataValue(existingState.doc, {
            icon: existingState.container.icon,
            name: trimmedName,
          });
          const update = exportUpdatesSince(existingState.doc, previousVersion);

          await enqueuePendingUpdate(existingState.container.id, update);
          await persistContainerState(existingState, { name: trimmedName });
          scheduleSync();
          runtime.log(`Explorer: renamed container to "${trimmedName}"`);
          return toContainerNode(existingState.container);
        });

      return writeChain;
    },

    shareWithUser(containerId, userId) {
      if (
        runtime.dbStatus !== "ready" ||
        !snapshot.ready ||
        !runtime.isAuthenticated ||
        !runtime.online
      ) {
        return Promise.resolve(false);
      }

      writeChain = writeChain
        .catch(() => null)
        .then(async () => {
          const existingState = containersById.get(containerId);
          if (!existingState?.record.documentId) {
            return null;
          }

          const shared = await runtime.apiClient.shareContainer(
            containerId,
            "user",
            userId,
            "write",
          );

          if (!shared) {
            return null;
          }

          existingState.recipientPublicKeys = resolveRecipientPublicKeys(
            shared.metadataRecipientEncapsulationPublicKeys,
            getLocalRecipientPublicKeys(runtime.encapsulationKeyPair),
          );
          await persistContainerState(existingState, {
            accessEpoch: shared.metadataAccessEpoch,
            documentId: shared.metadataDocumentId,
            metadataDocumentId: shared.metadataDocumentId,
          });

          await enqueuePendingUpdate(
            containerId,
            exportAllUpdates(existingState.doc),
          );
          await primeNotesForSharedSubtree(containerId);
          requestDomainNotesSync(runtime.domainScope);
          scheduleSync();
          runtime.log(
            `Explorer: shared container ${containerId} with ${userId}`,
          );
          return toContainerNode(existingState.container);
        });

      return writeChain.then((sharedNode) => sharedNode !== null);
    },

    getSnapshot() {
      return snapshot;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    updateRuntime(nextRuntime) {
      const previousRuntime = runtime;
      runtime = nextRuntime;

      if (nextRuntime.dbStatus !== "ready") {
        if (snapshot.ready || initialized || initializePromise) {
          resetStore();
        }
        lastEventCount = nextRuntime.events.length;
        return;
      }

      if (!previousRuntime.isAuthenticated && nextRuntime.isAuthenticated) {
        resetStore();
        lastEventCount = nextRuntime.events.length;
      }

      for (const containerState of containersById.values()) {
        if (!containerState.record.documentId) {
          containerState.recipientPublicKeys = getLocalRecipientPublicKeys(
            runtime.encapsulationKeyPair,
          );
        }
      }

      ensureInitialized();

      const regainedSyncPrerequisites =
        (!previousRuntime.online && nextRuntime.online) ||
        (!previousRuntime.isAuthenticated && nextRuntime.isAuthenticated) ||
        (!previousRuntime.encapsulationKeyPair &&
          !!nextRuntime.encapsulationKeyPair);

      handleRemoteEvents();

      if (snapshot.ready && regainedSyncPrerequisites) {
        scheduleRemoteHydration();
      }
    },
  };
}

function getOrCreateExplorerStore(
  domainScope: object,
  runtime: ExplorerRuntime,
): ExplorerStore {
  const existingStore = explorerStoresByScope.get(domainScope);
  if (existingStore) {
    return existingStore;
  }

  const nextStore = createExplorerStore(runtime);
  explorerStoresByScope.set(domainScope, nextStore);
  return nextStore;
}

export function ExplorerProvider({ children }: PropsWithChildren) {
  const runtime = useAppData();
  const store = useMemo(
    () => getOrCreateExplorerStore(runtime.domainScope, runtime),
    [runtime.domainScope],
  );

  useEffect(() => {
    store.updateRuntime(runtime);
  }, [store, runtime]);

  return (
    <ExplorerContext.Provider value={store}>
      {children}
    </ExplorerContext.Provider>
  );
}

export function useExplorer(): ExplorerContextValue {
  const store = useContext(ExplorerContext);
  if (!store) {
    throw new Error("useExplorer must be used within an ExplorerProvider.");
  }

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return {
    createChild: store.createChild,
    deleteContainer: store.deleteContainer,
    refresh: store.refresh,
    renameContainer: store.renameContainer,
    shareWithUser: store.shareWithUser,
    nodes: snapshot.nodes,
    ready: snapshot.ready,
  };
}
