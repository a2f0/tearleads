import { bytesToHex, encryptForRecipients } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  encryptLoroUpdate,
  exportAllUpdates,
  exportUpdatesSince,
  getTextValue,
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
import type { BlobBytes, BlobStore } from "../../data/blob-store";
import {
  decryptBlobEnvelope,
  rewrapBlobRecipientEnvelopes,
  serializeBlobEnvelope,
} from "../../data/blobEnvelope";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import {
  createPendingUpdateFields,
  decryptIncomingUpdates,
  encryptPendingUpdates,
  getLocalRecipientPublicKeys,
  getOrCreateDocumentEncryptionMaterial,
  isDocumentUpdateCreatedEvent,
  parseDocumentRecipientEnvelopes,
  resolveRecipientPublicKeys,
  serializeDocumentRecipientEnvelopes,
} from "../../data/documentSync";
import {
  addNoteAttachments,
  ensureNoteAttachmentStructure,
  getNoteAttachments,
  type NoteAttachment,
  sameNoteAttachments,
} from "./noteDocument";
import {
  deriveNoteTitle,
  type LocalAttachmentRecord,
  type NoteRecord,
  type NoteSummary,
  type NotesPersistence,
  type PendingAttachmentRecord,
  type PendingAttachmentRewrapRecord,
  type PendingUpdateRecord,
  sqlNotesPersistence,
} from "./notesPersistence";

type NotesDocument = Awaited<ReturnType<typeof createDocument>>;
type NotesAppData = ReturnType<typeof useAppData>;
type EncapsulationKeyPair = NonNullable<NotesRuntime["encapsulationKeyPair"]>;
type DocumentAttachmentBinding = NonNullable<
  Awaited<ReturnType<NotesRuntime["apiClient"]["listDocumentAttachments"]>>
>[number];
type DocumentEncryptionMaterial = Awaited<
  ReturnType<typeof getOrCreateDocumentEncryptionMaterial>
>;
type DocumentRecipientEnvelopes = ReturnType<
  typeof parseDocumentRecipientEnvelopes
>;
type CommitDocumentChangeResponse = NonNullable<
  Awaited<ReturnType<NotesRuntime["apiClient"]["commitDocumentChange"]>>
>;
type AttachmentCommitChange = {
  expectedBindingId: string | null;
  slotId: string;
  stageId: string;
};
type AttachmentRewrapChange = {
  expectedBindingId: string;
  recipientEnvelopes: Awaited<ReturnType<typeof rewrapBlobRecipientEnvelopes>>;
  slotId: string;
};
type PendingMutationSyncResult = {
  completed: boolean;
  nextRecord: NoteRecord;
};
interface DocumentSyncAttempt {
  currentDocumentRecipientEnvelopes: DocumentRecipientEnvelopes;
  encryptionMaterial: DocumentEncryptionMaterial | null;
  synced: NonNullable<
    Awaited<ReturnType<NotesRuntime["apiClient"]["syncDocument"]>>
  >;
}
export const DEFAULT_NOTE_ID = "default";

function sameAttachmentStorageKeys(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([slotId, storageKey]) => right[slotId] === storageKey)
  );
}

export interface NotesRuntime {
  apiClient: Pick<
    NotesAppData["apiClient"],
    | "commitDocumentChange"
    | "createDocument"
    | "getBlob"
    | "listDocumentAttachments"
    | "stageBlob"
    | "syncDocument"
  >;
  blobStore: BlobStore;
  containerId: NotesAppData["containerId"];
  dbStatus: NotesAppData["dbStatus"];
  domainScope: NotesAppData["domainScope"];
  encapsulationKeyPair: NotesAppData["encapsulationKeyPair"];
  events: NotesAppData["events"];
  execSql: NotesAppData["execSql"];
  isAuthenticated: NotesAppData["isAuthenticated"];
  log: NotesAppData["log"];
  online: NotesAppData["online"];
}

interface NoteAttachmentUpload {
  bytes: BlobBytes;
  name: string;
  mimeType: string | null;
}

interface NotesContextValue {
  attachments: ReadonlyArray<NoteAttachment>;
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  attachFiles: (files: ReadonlyArray<NoteAttachmentUpload>) => void;
  canAttach: boolean;
  documentId: string | null;
  ready: boolean;
  text: string;
  syncing: boolean;
  setText: (value: string) => void;
}

interface NotesSnapshot {
  attachments: ReadonlyArray<NoteAttachment>;
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>;
  canAttach: boolean;
  documentId: string | null;
  ready: boolean;
  text: string;
  syncing: boolean;
}

interface NotesStore {
  attachFiles: (files: ReadonlyArray<NoteAttachmentUpload>) => void;
  getSnapshot: () => NotesSnapshot;
  requestSync: () => void;
  setPersistedNoteListener: (
    listener: PersistedNoteListener | undefined,
  ) => void;
  setText: (value: string) => void;
  subscribe: (listener: () => void) => () => void;
  updateRuntime: (runtime: NotesRuntime) => void;
}

type PersistedNoteListener = (note: NoteSummary) => void;

const notesStoresByScope = new WeakMap<object, Map<string, NotesStore>>();
const NotesContext = createContext<NotesStore | null>(null);

export function createNotesStore(
  noteId: string,
  initialRuntime: NotesRuntime,
  persistence: NotesPersistence = sqlNotesPersistence,
  onPersistedNote?: PersistedNoteListener,
  initialDocumentId: string | null = null,
): NotesStore {
  let runtime = initialRuntime;
  let persistedNoteListener = onPersistedNote;
  let snapshot: NotesSnapshot = {
    attachments: [],
    attachmentStorageKeyBySlotId: {},
    canAttach: false,
    documentId: null,
    ready: false,
    text: "",
    syncing: false,
  };
  let doc: NotesDocument | null = null;
  let record: NoteRecord | null = null;
  let initialized = false;
  let initializePromise: Promise<void> | null = null;
  let syncPromise: Promise<void> | null = null;
  let syncRequested = false;
  let writeChain = Promise.resolve();
  let lastEventCount = 0;
  let pendingAttachments: PendingAttachmentRecord[] = [];
  let pendingAttachmentRewraps: PendingAttachmentRewrapRecord[] = [];
  let attachmentStorageKeyBySlotId: Record<string, string> = {};
  let recipientPublicKeys = getLocalRecipientPublicKeys(
    runtime.encapsulationKeyPair,
  );
  const listeners = new Set<() => void>();

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }

  function setSnapshot(next: NotesSnapshot) {
    if (
      sameNoteAttachments(snapshot.attachments, next.attachments) &&
      sameAttachmentStorageKeys(
        snapshot.attachmentStorageKeyBySlotId,
        next.attachmentStorageKeyBySlotId,
      ) &&
      snapshot.canAttach === next.canAttach &&
      snapshot.documentId === next.documentId &&
      snapshot.ready === next.ready &&
      snapshot.text === next.text &&
      snapshot.syncing === next.syncing
    ) {
      return;
    }

    snapshot = next;
    emit();
  }

  function updateRecipientPublicKeys(encodedPublicKeys: string[]) {
    recipientPublicKeys = resolveRecipientPublicKeys(
      encodedPublicKeys,
      getLocalRecipientPublicKeys(runtime.encapsulationKeyPair),
    );
  }

  function resetStore() {
    doc = null;
    record = null;
    pendingAttachments = [];
    pendingAttachmentRewraps = [];
    attachmentStorageKeyBySlotId = {};
    initialized = false;
    initializePromise = null;
    syncPromise = null;
    syncRequested = false;
    writeChain = Promise.resolve();
    recipientPublicKeys = getLocalRecipientPublicKeys(
      runtime.encapsulationKeyPair,
    );
    setSnapshot({
      attachments: [],
      attachmentStorageKeyBySlotId: {},
      canAttach: false,
      documentId: null,
      ready: false,
      text: "",
      syncing: false,
    });
  }

  function canAttachFiles(): boolean {
    return runtime.dbStatus === "ready" && !!runtime.encapsulationKeyPair;
  }

  function getSnapshotAttachments(
    currentDoc: NotesDocument | null = doc,
  ): NoteAttachment[] {
    return currentDoc ? getNoteAttachments(currentDoc) : [];
  }

  function getAttachmentStorageKeys(
    attachments: ReadonlyArray<NoteAttachment>,
  ): Record<string, string> {
    const nextStorageKeys: Record<string, string> = {};

    for (const attachment of attachments) {
      const storageKey = attachmentStorageKeyBySlotId[attachment.slotId];
      if (storageKey) {
        nextStorageKeys[attachment.slotId] = storageKey;
      }
    }

    return nextStorageKeys;
  }

  function setReadySnapshot(
    currentDoc: NotesDocument,
    syncing: boolean,
    text = getTextValue(currentDoc),
  ) {
    const attachments = getSnapshotAttachments(currentDoc);

    setSnapshot({
      attachments,
      attachmentStorageKeyBySlotId: getAttachmentStorageKeys(attachments),
      canAttach: canAttachFiles(),
      documentId: record?.documentId ?? null,
      ready: true,
      text,
      syncing,
    });
  }

  async function createNotesDocument() {
    const createdDoc = await createDocument(getScopedPeerSeed("notes"));
    ensureNoteAttachmentStructure(createdDoc);
    return createdDoc;
  }

  async function ensureRemoteDocument(
    currentDoc: NotesDocument,
    nextRecord: NoteRecord | null,
  ): Promise<NoteRecord | null> {
    if (nextRecord?.documentId) {
      return nextRecord;
    }

    if (!runtime.containerId) {
      runtime.log(
        "Notes: cannot create a remote document without a container.",
      );
      return nextRecord;
    }

    const created = await runtime.apiClient.createDocument([
      runtime.containerId,
    ]);
    if (!created) {
      return nextRecord;
    }

    updateRecipientPublicKeys(created.recipientEncapsulationPublicKeys);
    runtime.log(`Created notes document: ${created.id}`);

    return persistDocument(currentDoc, {
      documentId: created.id,
      documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
        created.documentRecipientEnvelopes,
      ),
      accessEpoch: created.currentAccessEpoch,
    });
  }

  async function createEncryptedBlobUpload(
    bytes: BlobBytes,
    recipientKeys: Uint8Array[],
  ): Promise<{
    byteLength: number;
    encryptedBytes: string;
    sha256: string;
  }> {
    const encryptedEnvelope = await encryptForRecipients(bytes, recipientKeys);
    const encryptedBytes = serializeBlobEnvelope(encryptedEnvelope);
    const encodedEnvelope = new TextEncoder().encode(encryptedBytes);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", encodedEnvelope),
    );

    return {
      byteLength: encodedEnvelope.byteLength,
      encryptedBytes,
      sha256: bytesToHex(digest),
    };
  }

  async function saveNoteRecord(nextRecord: NoteRecord) {
    await persistence.saveNote(runtime.execSql, nextRecord);
    record = nextRecord;
    persistedNoteListener?.({
      id: nextRecord.id,
      containerId: nextRecord.containerId,
      documentId: nextRecord.documentId,
      title: deriveNoteTitle(nextRecord.text),
      updatedAt: new Date().toISOString(),
    });
  }

  async function persistDocument(
    currentDoc: NotesDocument,
    patch: Partial<NoteRecord> = {},
  ): Promise<NoteRecord> {
    const hasDocumentRecipientEnvelopesPatch = Object.hasOwn(
      patch,
      "documentRecipientEnvelopes",
    );
    const nextRecord: NoteRecord = {
      id: record?.id ?? noteId,
      containerId:
        patch.containerId ?? record?.containerId ?? runtime.containerId ?? null,
      documentId: patch.documentId ?? record?.documentId ?? null,
      documentRecipientEnvelopes: hasDocumentRecipientEnvelopesPatch
        ? (patch.documentRecipientEnvelopes ?? null)
        : (record?.documentRecipientEnvelopes ?? null),
      text: patch.text ?? getTextValue(currentDoc),
      loroSnapshot:
        patch.loroSnapshot ?? bytesToBase64(exportAllUpdates(currentDoc)),
      accessEpoch: patch.accessEpoch ?? record?.accessEpoch ?? 1,
    };

    await saveNoteRecord(nextRecord);
    setReadySnapshot(currentDoc, snapshot.syncing, nextRecord.text);
    return nextRecord;
  }

  async function listPendingUpdates(): Promise<PendingUpdateRecord[]> {
    return persistence.listPendingUpdates(runtime.execSql, noteId);
  }

  async function listPendingAttachmentRecords(): Promise<
    PendingAttachmentRecord[]
  > {
    return persistence.listPendingAttachments(runtime.execSql, noteId);
  }

  async function listLocalAttachmentRecords() {
    return persistence.listLocalAttachments(runtime.execSql, noteId);
  }

  async function enqueuePendingUpdate(update: Uint8Array) {
    const pendingUpdateFields = createPendingUpdateFields(update);
    if (!pendingUpdateFields) {
      return;
    }

    await persistence.enqueuePendingUpdate(runtime.execSql, {
      noteId,
      ...pendingUpdateFields,
    });
  }

  async function deletePendingUpdate(id: string) {
    await persistence.deletePendingUpdate(runtime.execSql, id);
  }

  async function saveLocalAttachmentRecord(
    attachment: LocalAttachmentRecord,
    currentDoc: NotesDocument | null = doc,
  ) {
    await persistence.saveLocalAttachment(runtime.execSql, attachment);
    attachmentStorageKeyBySlotId = {
      ...attachmentStorageKeyBySlotId,
      [attachment.slotId]: attachment.storageKey,
    };

    if (currentDoc) {
      setReadySnapshot(
        currentDoc,
        snapshot.syncing,
        currentDoc === doc ? snapshot.text : getTextValue(currentDoc),
      );
    }
  }

  function listAttachmentsMissingLocalBytes(
    currentDoc: NotesDocument,
  ): NoteAttachment[] {
    return getNoteAttachments(currentDoc).filter(
      (attachment) => !attachmentStorageKeyBySlotId[attachment.slotId],
    );
  }

  async function hydrateMissingAttachmentBlob(
    currentDoc: NotesDocument,
    attachment: NoteAttachment,
    binding: DocumentAttachmentBinding,
    encapsulationKeyPair: EncapsulationKeyPair,
  ) {
    const blob = await runtime.apiClient.getBlob(binding.blobId);
    if (!blob) {
      return;
    }

    const blobDigest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(blob.encryptedBytes),
      ),
    );
    const blobSha256 = bytesToHex(blobDigest);
    if (blobSha256 !== blob.sha256) {
      runtime.log(
        `Notes: blob ${binding.blobId} sha256 mismatch during hydration.`,
      );
      return;
    }

    const decryptedBytes = await decryptBlobEnvelope(
      blob.encryptedBytes,
      encapsulationKeyPair.secretKey,
    );
    const storageKey = `blob-${binding.blobId}`;
    await runtime.blobStore.writeBytes(storageKey, decryptedBytes);
    await saveLocalAttachmentRecord(
      {
        blobId: binding.blobId,
        byteLength: attachment.byteLength,
        mimeType: attachment.mimeType,
        noteId,
        slotId: attachment.slotId,
        storageKey,
      },
      currentDoc,
    );
  }

  async function hydrateAttachmentBlobs(
    currentDoc: NotesDocument,
    currentRecord: NoteRecord | null,
  ) {
    const encapsulationKeyPair = runtime.encapsulationKeyPair;
    if (
      !encapsulationKeyPair ||
      !runtime.isAuthenticated ||
      !runtime.online ||
      !currentRecord?.documentId
    ) {
      return;
    }

    const attachmentsMissingLocalBytes =
      listAttachmentsMissingLocalBytes(currentDoc);
    if (attachmentsMissingLocalBytes.length === 0) {
      return;
    }

    const attachmentBindings = await runtime.apiClient.listDocumentAttachments(
      currentRecord.documentId,
    );
    if (!attachmentBindings) {
      return;
    }

    const bindingBySlotId = new Map(
      attachmentBindings.map((binding) => [binding.slotId, binding]),
    );

    for (const attachment of attachmentsMissingLocalBytes) {
      const binding = bindingBySlotId.get(attachment.slotId);
      if (!binding) {
        continue;
      }

      await hydrateMissingAttachmentBlob(
        currentDoc,
        attachment,
        binding,
        encapsulationKeyPair,
      );
    }
  }

  async function queueCommittedAttachmentsForRewrap(
    currentDoc: NotesDocument,
  ): Promise<boolean> {
    const currentAttachments = getNoteAttachments(currentDoc);
    if (currentAttachments.length === 0) {
      return false;
    }

    const localAttachments = await listLocalAttachmentRecords();
    const localAttachmentBySlotId = new Map(
      localAttachments.map((attachment) => [attachment.slotId, attachment]),
    );
    const nextPendingAttachmentRewraps: PendingAttachmentRewrapRecord[] = [];

    for (const attachment of currentAttachments) {
      if (isAttachmentSyncAlreadyPending(attachment.slotId)) {
        continue;
      }

      const localAttachment = localAttachmentBySlotId.get(attachment.slotId);
      if (!localAttachment?.blobId) {
        continue;
      }

      nextPendingAttachmentRewraps.push(
        await createPendingAttachmentRewrap(
          attachment.slotId,
          localAttachment.blobId,
        ),
      );
    }

    if (nextPendingAttachmentRewraps.length === 0) {
      return false;
    }

    mergePendingAttachmentRewraps(nextPendingAttachmentRewraps);

    return true;
  }

  function isAttachmentSyncAlreadyPending(slotId: string): boolean {
    return (
      pendingAttachmentRewraps.some(
        (pendingAttachmentRewrap) => pendingAttachmentRewrap.slotId === slotId,
      ) ||
      pendingAttachments.some(
        (pendingAttachment) => pendingAttachment.slotId === slotId,
      )
    );
  }

  async function createPendingAttachmentRewrap(
    slotId: string,
    blobId: string,
  ): Promise<PendingAttachmentRewrapRecord> {
    const pendingAttachmentRewrap: PendingAttachmentRewrapRecord = {
      blobId,
      noteId,
      slotId,
    };
    await persistence.savePendingAttachmentRewrap(
      runtime.execSql,
      pendingAttachmentRewrap,
    );
    return pendingAttachmentRewrap;
  }

  function mergePendingAttachmentRewraps(
    nextPendingAttachmentRewraps: ReadonlyArray<PendingAttachmentRewrapRecord>,
  ) {
    const nextSlotIds = new Set(
      nextPendingAttachmentRewraps.map(
        (pendingAttachmentRewrap) => pendingAttachmentRewrap.slotId,
      ),
    );
    pendingAttachmentRewraps = [
      ...pendingAttachmentRewraps.filter(
        (existingAttachmentRewrap) =>
          !nextSlotIds.has(existingAttachmentRewrap.slotId),
      ),
      ...nextPendingAttachmentRewraps,
    ];
  }

  async function replacePendingUpdatesWithBaseline(currentDoc: NotesDocument) {
    await persistence.deletePendingUpdates(runtime.execSql, noteId);
    await enqueuePendingUpdate(exportAllUpdates(currentDoc));
  }

  async function initialize() {
    if (runtime.dbStatus !== "ready") {
      return;
    }

    await persistence.ensureSchema(runtime.execSql);

    const nextDoc = await createNotesDocument();
    const [
      existing,
      loadedPendingAttachments,
      loadedPendingAttachmentRewraps,
      localAttachments,
    ] = await Promise.all([
      persistence.loadNote(runtime.execSql, noteId),
      listPendingAttachmentRecords(),
      persistence.listPendingAttachmentRewraps(runtime.execSql, noteId),
      listLocalAttachmentRecords(),
    ]);
    pendingAttachments = loadedPendingAttachments;
    pendingAttachmentRewraps = loadedPendingAttachmentRewraps;
    attachmentStorageKeyBySlotId = Object.fromEntries(
      localAttachments.map((attachment) => [
        attachment.slotId,
        attachment.storageKey,
      ]),
    );

    if (existing) {
      if (existing.loroSnapshot.length > 0) {
        importUpdates(nextDoc, [base64ToBytes(existing.loroSnapshot)]);
      }

      record = existing;
      setReadySnapshot(nextDoc, false);
    } else {
      const created: NoteRecord = {
        id: noteId,
        containerId: runtime.containerId ?? null,
        documentId: initialDocumentId,
        documentRecipientEnvelopes: null,
        text: "",
        loroSnapshot: bytesToBase64(exportAllUpdates(nextDoc)),
        accessEpoch: 1,
      };
      await saveNoteRecord(created);
      setReadySnapshot(nextDoc, false, "");
    }

    doc = nextDoc;
    initialized = true;
    initializePromise = null;
    scheduleSync();
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

  function isDestroyedDatabaseError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message === "Database worker client has been destroyed."
    );
  }

  function setSyncing(syncing: boolean) {
    setSnapshot({
      attachments: snapshot.attachments,
      attachmentStorageKeyBySlotId: snapshot.attachmentStorageKeyBySlotId,
      canAttach: snapshot.canAttach,
      documentId: snapshot.documentId,
      ready: snapshot.ready,
      text: snapshot.text,
      syncing,
    });
  }

  async function awaitInitializationForSync(): Promise<boolean> {
    if (!initializePromise) {
      return true;
    }

    try {
      await initializePromise;
      return true;
    } catch (error) {
      if (isDestroyedDatabaseError(error)) {
        return false;
      }

      throw error;
    }
  }

  function canRunScheduledSync(): boolean {
    return (
      doc !== null &&
      snapshot.ready &&
      runtime.online &&
      runtime.isAuthenticated &&
      runtime.encapsulationKeyPair !== null
    );
  }

  async function buildAttachmentCommits(
    attachmentsToCommit: PendingAttachmentRecord[],
    currentBindings: ReadonlyArray<DocumentAttachmentBinding>,
  ): Promise<AttachmentCommitChange[] | null> {
    const currentBindingBySlotId = new Map(
      currentBindings.map((binding) => [binding.slotId, binding]),
    );
    const attachmentCommits: AttachmentCommitChange[] = [];

    for (const attachment of attachmentsToCommit) {
      const localBytes = await runtime.blobStore.readBytes(
        attachment.storageKey,
      );
      if (!localBytes) {
        runtime.log(
          `Notes: missing local blob bytes for attachment ${attachment.slotId}.`,
        );
        return null;
      }

      const stagedBlob = await createEncryptedBlobUpload(
        localBytes,
        recipientPublicKeys,
      );
      const stage = await runtime.apiClient.stageBlob(stagedBlob);

      if (!stage) {
        return null;
      }

      attachmentCommits.push({
        expectedBindingId:
          currentBindingBySlotId.get(attachment.slotId)?.bindingId ?? null,
        slotId: attachment.slotId,
        stageId: stage.stageId,
      });
    }

    return attachmentCommits;
  }

  async function buildAttachmentRewraps(
    attachmentsToRewrap: PendingAttachmentRewrapRecord[],
    currentBindings: ReadonlyArray<DocumentAttachmentBinding>,
    encapsulationKeyPair: EncapsulationKeyPair,
  ): Promise<AttachmentRewrapChange[] | null> {
    const currentBindingBySlotId = new Map(
      currentBindings.map((binding) => [binding.slotId, binding]),
    );
    const blobById = new Map<
      string,
      Awaited<ReturnType<NotesRuntime["apiClient"]["getBlob"]>>
    >();
    const attachmentRewraps: AttachmentRewrapChange[] = [];

    for (const attachment of attachmentsToRewrap) {
      const currentBinding = currentBindingBySlotId.get(attachment.slotId);
      if (!currentBinding || currentBinding.blobId !== attachment.blobId) {
        continue;
      }

      let blob = blobById.get(attachment.blobId);
      if (!blob) {
        blob = await runtime.apiClient.getBlob(attachment.blobId);
        if (!blob) {
          return null;
        }
        blobById.set(attachment.blobId, blob);
      }

      attachmentRewraps.push({
        expectedBindingId: currentBinding.bindingId,
        recipientEnvelopes: await rewrapBlobRecipientEnvelopes({
          encryptedBytes: blob.encryptedBytes,
          recipientPublicKeys,
          secretKey: encapsulationKeyPair.secretKey,
        }),
        slotId: attachment.slotId,
      });
    }

    return attachmentRewraps;
  }

  async function commitBaselineChange(
    currentDoc: NotesDocument,
    nextRemoteRecord: NoteRecord,
    encapsulationKeyPair: EncapsulationKeyPair,
    attachmentCommits: AttachmentCommitChange[],
    attachmentRewraps: AttachmentRewrapChange[],
  ): Promise<CommitDocumentChangeResponse | null> {
    if (!nextRemoteRecord.documentId) {
      return null;
    }

    const baselineUpdate = exportAllUpdates(currentDoc);
    const baselineUpdateFields = createPendingUpdateFields(baselineUpdate);
    if (!baselineUpdateFields) {
      return null;
    }

    const currentDocumentRecipientEnvelopes = parseDocumentRecipientEnvelopes(
      nextRemoteRecord.documentRecipientEnvelopes,
    );
    const { documentKey, documentRecipientEnvelopes } =
      await getOrCreateDocumentEncryptionMaterial({
        documentRecipientEnvelopes: currentDocumentRecipientEnvelopes,
        recipientPublicKeys,
        secretKey: encapsulationKeyPair.secretKey,
      });
    const encryptedBaseline = await encryptLoroUpdate(
      baselineUpdate,
      nextRemoteRecord.accessEpoch,
      documentKey,
    );

    return runtime.apiClient.commitDocumentChange(nextRemoteRecord.documentId, {
      accessEpoch: nextRemoteRecord.accessEpoch,
      attachmentCommits,
      attachmentDetaches: [],
      attachmentRewraps,
      documentRecipientEnvelopes,
      loroUpdate: {
        encryptedData: encryptedBaseline,
        id: crypto.randomUUID(),
        partialEndVersionVector: baselineUpdateFields.partialEndVersionVector,
        partialStartVersionVector:
          baselineUpdateFields.partialStartVersionVector,
        referencedSlotIds: getNoteAttachments(currentDoc).map(
          (attachment) => attachment.slotId,
        ),
      },
    });
  }

  async function saveCommittedAttachmentRecords(
    currentDoc: NotesDocument,
    attachmentsToCommit: ReadonlyArray<PendingAttachmentRecord>,
    committedBindings: CommitDocumentChangeResponse["committedBindings"],
  ) {
    const localAttachmentBySlotId = new Map(
      attachmentsToCommit.map((attachment) => [attachment.slotId, attachment]),
    );

    for (const committedBinding of committedBindings) {
      const localAttachment = localAttachmentBySlotId.get(
        committedBinding.slotId,
      );
      if (!localAttachment) {
        continue;
      }

      await saveLocalAttachmentRecord(
        {
          blobId: committedBinding.blobId,
          byteLength: localAttachment.byteLength,
          mimeType: localAttachment.mimeType,
          noteId,
          slotId: localAttachment.slotId,
          storageKey: localAttachment.storageKey,
        },
        currentDoc,
      );
    }
  }

  function getCurrentSyncState(): {
    currentDoc: NotesDocument;
    currentRecord: NoteRecord;
  } | null {
    if (!doc || !record || !runtime.online || !runtime.isAuthenticated) {
      return null;
    }

    return {
      currentDoc: doc,
      currentRecord: record,
    };
  }

  async function listCurrentDocumentBindings(
    documentId: string,
  ): Promise<ReadonlyArray<DocumentAttachmentBinding> | null> {
    return runtime.apiClient.listDocumentAttachments(documentId);
  }

  async function runSerializedMutation(
    nextRecord: NoteRecord,
    onError: string,
    task: () => Promise<PendingMutationSyncResult>,
  ): Promise<PendingMutationSyncResult> {
    let result: PendingMutationSyncResult = {
      completed: false,
      nextRecord,
    };

    writeChain = writeChain
      .catch(() => undefined)
      .then(async () => {
        result = await task();
      })
      .catch((error: unknown) => {
        console.error(onError, error);
      });

    await writeChain;
    return result;
  }

  async function runPendingAttachmentSyncTask(
    nextRecord: NoteRecord,
    encapsulationKeyPair: EncapsulationKeyPair,
  ): Promise<PendingMutationSyncResult> {
    const currentSyncState = getCurrentSyncState();
    if (!currentSyncState) {
      return { completed: false, nextRecord };
    }
    const { currentDoc, currentRecord } = currentSyncState;

    const nextRemoteRecord = await ensureRemoteDocument(
      currentDoc,
      currentRecord,
    );
    if (!nextRemoteRecord?.documentId) {
      return { completed: false, nextRecord };
    }

    const attachmentsToCommit = [...pendingAttachments];
    if (attachmentsToCommit.length === 0) {
      return { completed: false, nextRecord };
    }

    const currentBindings = await listCurrentDocumentBindings(
      nextRemoteRecord.documentId,
    );
    if (!currentBindings) {
      return { completed: false, nextRecord };
    }

    const attachmentCommits = await buildAttachmentCommits(
      attachmentsToCommit,
      currentBindings,
    );
    if (!attachmentCommits) {
      return { completed: false, nextRecord };
    }

    const committed = await commitBaselineChange(
      currentDoc,
      nextRemoteRecord,
      encapsulationKeyPair,
      attachmentCommits,
      [],
    );
    if (!committed) {
      return { completed: false, nextRecord };
    }

    return {
      completed: true,
      nextRecord: await finalizePendingAttachmentSync(
        currentDoc,
        nextRemoteRecord.documentId,
        attachmentsToCommit,
        committed,
      ),
    };
  }

  async function syncPendingAttachments(
    nextRecord: NoteRecord,
    encapsulationKeyPair: EncapsulationKeyPair,
  ): Promise<PendingMutationSyncResult> {
    if (pendingAttachments.length === 0) {
      return { completed: false, nextRecord };
    }

    return runSerializedMutation(
      nextRecord,
      "Failed to sync note attachments:",
      () => runPendingAttachmentSyncTask(nextRecord, encapsulationKeyPair),
    );
  }

  async function finalizePendingAttachmentSync(
    currentDoc: NotesDocument,
    documentId: string,
    attachmentsToCommit: ReadonlyArray<PendingAttachmentRecord>,
    committed: CommitDocumentChangeResponse,
  ): Promise<NoteRecord> {
    await saveCommittedAttachmentRecords(
      currentDoc,
      attachmentsToCommit,
      committed.committedBindings,
    );
    await clearSyncedPendingAttachments(attachmentsToCommit);
    return persistCommittedDocumentRecord(currentDoc, documentId, committed);
  }

  async function clearSyncedPendingAttachments(
    attachmentsToCommit: ReadonlyArray<PendingAttachmentRecord>,
  ) {
    const committedSlotIds = new Set(
      attachmentsToCommit.map(
        (attachmentToCommit) => attachmentToCommit.slotId,
      ),
    );
    pendingAttachments = pendingAttachments.filter(
      (pendingAttachment) => !committedSlotIds.has(pendingAttachment.slotId),
    );
    await persistence.deletePendingAttachments(runtime.execSql, noteId);
    await persistence.deletePendingUpdates(runtime.execSql, noteId);
  }

  async function persistCommittedDocumentRecord(
    currentDoc: NotesDocument,
    documentId: string,
    committed: CommitDocumentChangeResponse,
  ): Promise<NoteRecord> {
    return persistDocument(currentDoc, {
      accessEpoch: committed.currentAccessEpoch,
      documentId,
      documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
        committed.documentRecipientEnvelopes,
      ),
    });
  }

  async function runPendingAttachmentRewrapTask(
    nextRecord: NoteRecord,
    encapsulationKeyPair: EncapsulationKeyPair,
  ): Promise<PendingMutationSyncResult> {
    const currentSyncState = getCurrentSyncState();
    if (!currentSyncState) {
      return { completed: false, nextRecord };
    }
    const { currentDoc, currentRecord } = currentSyncState;

    const nextRemoteRecord = await ensureRemoteDocument(
      currentDoc,
      currentRecord,
    );
    if (!nextRemoteRecord?.documentId) {
      return { completed: false, nextRecord };
    }

    const attachmentsToRewrap = [...pendingAttachmentRewraps];
    if (attachmentsToRewrap.length === 0) {
      return { completed: false, nextRecord };
    }

    const currentBindings = await listCurrentDocumentBindings(
      nextRemoteRecord.documentId,
    );
    if (!currentBindings) {
      return { completed: false, nextRecord };
    }

    const attachmentRewraps = await buildAttachmentRewraps(
      attachmentsToRewrap,
      currentBindings,
      encapsulationKeyPair,
    );
    if (!attachmentRewraps) {
      return { completed: false, nextRecord };
    }
    if (attachmentRewraps.length === 0) {
      return clearEmptyPendingAttachmentRewraps(nextRecord);
    }

    const committed = await commitBaselineChange(
      currentDoc,
      nextRemoteRecord,
      encapsulationKeyPair,
      [],
      attachmentRewraps,
    );
    if (!committed) {
      return { completed: false, nextRecord };
    }

    return {
      completed: true,
      nextRecord: await finalizePendingAttachmentRewrapSync(
        currentDoc,
        nextRemoteRecord.documentId,
        attachmentsToRewrap,
        committed,
      ),
    };
  }

  async function syncPendingAttachmentRewraps(
    nextRecord: NoteRecord,
    encapsulationKeyPair: EncapsulationKeyPair,
  ): Promise<PendingMutationSyncResult> {
    if (pendingAttachmentRewraps.length === 0) {
      return { completed: false, nextRecord };
    }

    return runSerializedMutation(
      nextRecord,
      "Failed to rewrap note attachments:",
      () => runPendingAttachmentRewrapTask(nextRecord, encapsulationKeyPair),
    );
  }

  async function clearEmptyPendingAttachmentRewraps(
    nextRecord: NoteRecord,
  ): Promise<PendingMutationSyncResult> {
    await clearPendingAttachmentRewraps();
    return { completed: false, nextRecord };
  }

  async function finalizePendingAttachmentRewrapSync(
    currentDoc: NotesDocument,
    documentId: string,
    attachmentsToRewrap: ReadonlyArray<PendingAttachmentRewrapRecord>,
    committed: CommitDocumentChangeResponse,
  ): Promise<NoteRecord> {
    await clearSyncedPendingAttachmentRewraps(attachmentsToRewrap);
    return persistCommittedDocumentRecord(currentDoc, documentId, committed);
  }

  async function clearPendingAttachmentRewraps() {
    pendingAttachmentRewraps = [];
    await persistence.deletePendingAttachmentRewraps(runtime.execSql, noteId);
  }

  async function clearSyncedPendingAttachmentRewraps(
    attachmentsToRewrap: ReadonlyArray<PendingAttachmentRewrapRecord>,
  ) {
    const syncedSlotIds = new Set(
      attachmentsToRewrap.map(
        (attachmentToRewrap) => attachmentToRewrap.slotId,
      ),
    );
    pendingAttachmentRewraps = pendingAttachmentRewraps.filter(
      (pendingAttachmentRewrap) =>
        !syncedSlotIds.has(pendingAttachmentRewrap.slotId),
    );
    await persistence.deletePendingAttachmentRewraps(runtime.execSql, noteId);
    await persistence.deletePendingUpdates(runtime.execSql, noteId);
  }

  async function ensureDocumentRecordForSync(
    currentDoc: NotesDocument,
    nextRecord: NoteRecord,
    pendingUpdates: PendingUpdateRecord[],
  ): Promise<NoteRecord | null> {
    if (nextRecord.documentId || pendingUpdates.length === 0) {
      return nextRecord;
    }

    return ensureRemoteDocument(currentDoc, nextRecord);
  }

  async function requestDocumentSync(
    currentDoc: NotesDocument,
    currentRecord: NoteRecord,
    pendingUpdates: PendingUpdateRecord[],
    encapsulationKeyPair: EncapsulationKeyPair,
  ): Promise<DocumentSyncAttempt | null> {
    if (!currentRecord.documentId) {
      return null;
    }

    const currentDocumentRecipientEnvelopes = parseDocumentRecipientEnvelopes(
      currentRecord.documentRecipientEnvelopes,
    );
    const encryptionMaterial =
      pendingUpdates.length > 0
        ? await getOrCreateDocumentEncryptionMaterial({
            documentRecipientEnvelopes: currentDocumentRecipientEnvelopes,
            recipientPublicKeys,
            secretKey: encapsulationKeyPair.secretKey,
          })
        : null;
    const outgoingUpdates = encryptionMaterial
      ? await encryptPendingUpdates(
          pendingUpdates,
          currentRecord.accessEpoch,
          encryptionMaterial.documentKey,
        )
      : [];
    const synced = await runtime.apiClient.syncDocument(
      currentRecord.documentId,
      currentRecord.accessEpoch,
      encodeVersionVector(currentDoc),
      outgoingUpdates,
      encryptionMaterial && currentDocumentRecipientEnvelopes === null
        ? encryptionMaterial.documentRecipientEnvelopes
        : undefined,
    );
    if (!synced) {
      return null;
    }

    return {
      currentDocumentRecipientEnvelopes,
      encryptionMaterial,
      synced,
    };
  }

  function resolveNextDocumentRecipientEnvelopes(
    currentRecord: NoteRecord,
    syncAttempt: DocumentSyncAttempt,
  ): DocumentRecipientEnvelopes {
    const { currentDocumentRecipientEnvelopes, encryptionMaterial, synced } =
      syncAttempt;

    if (synced.currentAccessEpoch !== currentRecord.accessEpoch) {
      return synced.documentRecipientEnvelopes ?? null;
    }

    return (
      synced.documentRecipientEnvelopes ??
      (encryptionMaterial && currentDocumentRecipientEnvelopes === null
        ? encryptionMaterial.documentRecipientEnvelopes
        : currentDocumentRecipientEnvelopes)
    );
  }

  async function applyIncomingSyncedUpdates(
    currentDoc: NotesDocument,
    synced: DocumentSyncAttempt["synced"],
    nextDocumentRecipientEnvelopes: DocumentRecipientEnvelopes,
    encapsulationKeyPair: EncapsulationKeyPair,
  ) {
    if (synced.updates.length === 0) {
      return;
    }

    if (!nextDocumentRecipientEnvelopes) {
      runtime.log(
        "Notes: skipped incoming updates because the current document key bundle is missing.",
      );
      return;
    }

    const { documentKey } = await getOrCreateDocumentEncryptionMaterial({
      documentRecipientEnvelopes: nextDocumentRecipientEnvelopes,
      recipientPublicKeys,
      secretKey: encapsulationKeyPair.secretKey,
    });
    const decrypted = await decryptIncomingUpdates(
      synced.updates,
      synced.currentAccessEpoch,
      documentKey,
      (message) => runtime.log(`Notes: ${message}`),
    );
    if (decrypted.length === 0) {
      return;
    }

    importUpdates(currentDoc, decrypted);
    setReadySnapshot(currentDoc, true);
  }

  async function finalizeDocumentSync(
    currentDoc: NotesDocument,
    currentRecord: NoteRecord,
    syncAttempt: DocumentSyncAttempt,
    encapsulationKeyPair: EncapsulationKeyPair,
  ): Promise<NoteRecord> {
    const { synced } = syncAttempt;
    updateRecipientPublicKeys(synced.recipientEncapsulationPublicKeys);

    for (const acceptedOutgoingUpdateId of synced.acceptedOutgoingUpdateIds) {
      await deletePendingUpdate(acceptedOutgoingUpdateId);
    }

    const previousAccessEpoch = currentRecord.accessEpoch;
    const nextDocumentRecipientEnvelopes =
      resolveNextDocumentRecipientEnvelopes(currentRecord, syncAttempt);
    await applyIncomingSyncedUpdates(
      currentDoc,
      synced,
      nextDocumentRecipientEnvelopes,
      encapsulationKeyPair,
    );

    const nextRecord = await persistDocument(currentDoc, {
      documentId: currentRecord.documentId,
      accessEpoch: synced.currentAccessEpoch,
      documentRecipientEnvelopes: serializeDocumentRecipientEnvelopes(
        nextDocumentRecipientEnvelopes,
      ),
    });

    if (synced.currentAccessEpoch !== previousAccessEpoch) {
      const queuedAttachmentRewrap =
        await queueCommittedAttachmentsForRewrap(currentDoc);
      if (!queuedAttachmentRewrap) {
        await replacePendingUpdatesWithBaseline(currentDoc);
      }
      syncRequested = true;
    }

    await hydrateAttachmentBlobs(currentDoc, nextRecord);
    return nextRecord;
  }

  async function syncDocumentState(
    currentDoc: NotesDocument,
    nextRecord: NoteRecord,
    encapsulationKeyPair: EncapsulationKeyPair,
  ): Promise<NoteRecord> {
    const pendingUpdates = await listPendingUpdates();
    const nextRemoteRecord = await ensureDocumentRecordForSync(
      currentDoc,
      nextRecord,
      pendingUpdates,
    );
    if (!nextRemoteRecord?.documentId) {
      return nextRecord;
    }

    const syncAttempt = await requestDocumentSync(
      currentDoc,
      nextRemoteRecord,
      pendingUpdates,
      encapsulationKeyPair,
    );
    if (!syncAttempt) {
      return nextRemoteRecord;
    }

    return finalizeDocumentSync(
      currentDoc,
      nextRemoteRecord,
      syncAttempt,
      encapsulationKeyPair,
    );
  }

  async function runSyncPass() {
    const currentDoc = doc;
    const encapsulationKeyPair = runtime.encapsulationKeyPair;
    let nextRecord = record;

    if (!currentDoc || !nextRecord || !encapsulationKeyPair) {
      return;
    }

    const attachmentResult = await syncPendingAttachments(
      nextRecord,
      encapsulationKeyPair,
    );
    nextRecord = attachmentResult.nextRecord;
    if (attachmentResult.completed) {
      syncRequested = true;
      return;
    }

    const rewrapResult = await syncPendingAttachmentRewraps(
      nextRecord,
      encapsulationKeyPair,
    );
    nextRecord = rewrapResult.nextRecord;
    if (rewrapResult.completed) {
      syncRequested = true;
      return;
    }

    await syncDocumentState(currentDoc, nextRecord, encapsulationKeyPair);
  }

  async function runScheduledSyncIteration(): Promise<boolean> {
    if (!(await awaitInitializationForSync())) {
      return false;
    }

    if (!canRunScheduledSync()) {
      return true;
    }

    try {
      await runSyncPass();
      return true;
    } catch (error) {
      if (isDestroyedDatabaseError(error)) {
        return false;
      }

      throw error;
    } finally {
      setSyncing(false);
    }
  }

  async function runScheduledSyncLoop() {
    setSyncing(true);

    try {
      while (syncRequested) {
        syncRequested = false;

        const shouldContinue = await runScheduledSyncIteration();
        if (!shouldContinue) {
          return;
        }
      }
    } finally {
      setSyncing(false);
    }
  }

  function scheduleSync() {
    syncRequested = true;

    if (syncPromise) {
      return;
    }

    syncPromise = (async () => {
      try {
        await runScheduledSyncLoop();
      } catch (error) {
        console.error("Failed to sync notes:", error);
      } finally {
        const shouldRetry = syncRequested;
        syncPromise = null;
        if (shouldRetry) {
          scheduleSync();
        }
      }
    })();
  }

  function handleRemoteEvents() {
    if (!record?.documentId) {
      lastEventCount = runtime.events.length;
      return;
    }

    const nextEvents = runtime.events.slice(lastEventCount);
    lastEventCount = runtime.events.length;

    if (
      nextEvents.some(
        (event) =>
          isDocumentUpdateCreatedEvent(event) &&
          event.documentId === record?.documentId,
      )
    ) {
      scheduleSync();
    }
  }

  function buildPendingAttachments(
    files: ReadonlyArray<NoteAttachmentUpload>,
  ): {
    nextAttachments: NoteAttachment[];
    nextPendingAttachments: PendingAttachmentRecord[];
  } {
    const nextPendingAttachments: PendingAttachmentRecord[] = [];
    const nextAttachments: NoteAttachment[] = [];

    for (const file of files) {
      const slotId = crypto.randomUUID();
      const storageKey = `${noteId}-${slotId}`;
      nextPendingAttachments.push({
        byteLength: file.bytes.byteLength,
        mimeType: file.mimeType,
        name: file.name,
        noteId,
        slotId,
        storageKey,
      });
      nextAttachments.push({
        byteLength: file.bytes.byteLength,
        mimeType: file.mimeType,
        name: file.name,
        slotId,
      });
    }

    return { nextAttachments, nextPendingAttachments };
  }

  async function persistPendingAttachments(
    files: ReadonlyArray<NoteAttachmentUpload>,
    nextPendingAttachments: PendingAttachmentRecord[],
  ) {
    for (const [index, pendingAttachment] of nextPendingAttachments.entries()) {
      const sourceFile = files[index];
      if (!sourceFile) {
        continue;
      }

      await runtime.blobStore.writeBytes(
        pendingAttachment.storageKey,
        sourceFile.bytes,
      );
      await saveLocalAttachmentRecord({
        blobId: null,
        byteLength: pendingAttachment.byteLength,
        mimeType: pendingAttachment.mimeType,
        noteId,
        slotId: pendingAttachment.slotId,
        storageKey: pendingAttachment.storageKey,
      });
      await persistence.savePendingAttachment(
        runtime.execSql,
        pendingAttachment,
      );
    }
  }

  function logAttachedFiles(count: number) {
    runtime.log(
      runtime.online && runtime.isAuthenticated
        ? `Attached ${count} file${count === 1 ? "" : "s"} to note ${noteId}.`
        : `Stored ${count} attachment${count === 1 ? "" : "s"} locally for note ${noteId}.`,
    );
  }

  async function persistAttachedFiles(
    files: ReadonlyArray<NoteAttachmentUpload>,
  ) {
    const currentDoc = doc;
    const encapsulationKeyPair = runtime.encapsulationKeyPair;

    if (!currentDoc || !canAttachFiles() || !encapsulationKeyPair) {
      runtime.log("Notes: attachments require a local key package.");
      return;
    }

    const { nextAttachments, nextPendingAttachments } =
      buildPendingAttachments(files);
    const previousVersion = encodeVersionVector(currentDoc);
    addNoteAttachments(currentDoc, nextAttachments);
    const attachmentUpdate = exportUpdatesSince(currentDoc, previousVersion);
    if (attachmentUpdate.byteLength > 0) {
      await enqueuePendingUpdate(attachmentUpdate);
    }

    await persistPendingAttachments(files, nextPendingAttachments);

    pendingAttachments = [...pendingAttachments, ...nextPendingAttachments];
    await persistDocument(currentDoc);
    logAttachedFiles(files.length);
    scheduleSync();
  }

  function refreshAttachabilitySnapshot() {
    if (!snapshot.ready) {
      return;
    }

    setSnapshot({
      attachments: snapshot.attachments,
      attachmentStorageKeyBySlotId: snapshot.attachmentStorageKeyBySlotId,
      canAttach: canAttachFiles(),
      documentId: snapshot.documentId,
      ready: snapshot.ready,
      text: snapshot.text,
      syncing: snapshot.syncing,
    });
  }

  function regainedSyncPrerequisites(
    previousRuntime: NotesRuntime,
    nextRuntime: NotesRuntime,
  ): boolean {
    return (
      (!previousRuntime.online && nextRuntime.online) ||
      (!previousRuntime.isAuthenticated && nextRuntime.isAuthenticated) ||
      (!previousRuntime.encapsulationKeyPair &&
        !!nextRuntime.encapsulationKeyPair)
    );
  }

  return {
    attachFiles(files: ReadonlyArray<NoteAttachmentUpload>) {
      if (files.length === 0 || !doc) {
        return;
      }

      writeChain = writeChain
        .catch(() => undefined)
        .then(async () => persistAttachedFiles(files))
        .catch((error: unknown) => {
          console.error("Failed to attach note files:", error);
        });
    },
    getSnapshot() {
      return snapshot;
    },
    requestSync() {
      scheduleSync();
    },
    setPersistedNoteListener(listener) {
      persistedNoteListener = listener;
    },
    setText(value: string) {
      if (!doc) {
        return;
      }

      setSnapshot({
        attachments: snapshot.attachments,
        attachmentStorageKeyBySlotId: snapshot.attachmentStorageKeyBySlotId,
        canAttach: snapshot.canAttach,
        documentId: snapshot.documentId,
        ready: snapshot.ready,
        text: value,
        syncing: snapshot.syncing,
      });

      writeChain = writeChain
        .catch(() => undefined)
        .then(async () => {
          if (!doc) {
            return;
          }

          if (getTextValue(doc) === value) {
            return;
          }

          const previousTextVersion = encodeVersionVector(doc);
          doc.getText("text").update(value);
          const update = exportUpdatesSince(doc, previousTextVersion);

          await enqueuePendingUpdate(update);
          await persistDocument(doc, { text: value });
          scheduleSync();
        })
        .catch((error: unknown) => {
          console.error("Failed to persist note changes:", error);
        });
    },
    subscribe(listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    updateRuntime(nextRuntime: NotesRuntime) {
      const previousRuntime = runtime;
      runtime = nextRuntime;
      if (!record?.documentId) {
        recipientPublicKeys = getLocalRecipientPublicKeys(
          runtime.encapsulationKeyPair,
        );
      }

      if (nextRuntime.dbStatus !== "ready") {
        if (snapshot.ready || initialized || initializePromise) {
          resetStore();
        }
        lastEventCount = nextRuntime.events.length;
        return;
      }

      refreshAttachabilitySnapshot();
      ensureInitialized();
      handleRemoteEvents();

      if (
        snapshot.ready &&
        regainedSyncPrerequisites(previousRuntime, runtime)
      ) {
        scheduleSync();
      }
    },
  };
}

function getOrCreateNotesStore(
  domainScope: object,
  noteId: string,
  runtime: NotesRuntime,
  onPersistedNote?: PersistedNoteListener,
  initialDocumentId: string | null = null,
): NotesStore {
  const existingStores = notesStoresByScope.get(domainScope);
  if (existingStores) {
    const existingStore = existingStores.get(noteId);
    if (existingStore) {
      existingStore.setPersistedNoteListener(onPersistedNote);
      return existingStore;
    }
  }

  const nextStore = createNotesStore(
    noteId,
    runtime,
    sqlNotesPersistence,
    onPersistedNote,
    initialDocumentId,
  );
  const stores = existingStores ?? new Map<string, NotesStore>();
  stores.set(noteId, nextStore);
  notesStoresByScope.set(domainScope, stores);
  return nextStore;
}

export function primeNotesStore(
  domainScope: object,
  noteId: string,
  runtime: NotesRuntime,
  onPersistedNote?: PersistedNoteListener,
  initialDocumentId: string | null = null,
): NotesStore {
  const store = getOrCreateNotesStore(
    domainScope,
    noteId,
    runtime,
    onPersistedNote,
    initialDocumentId,
  );
  store.updateRuntime(runtime);
  return store;
}

export function requestDomainNotesSync(domainScope: object): void {
  const stores = notesStoresByScope.get(domainScope);
  if (!stores) {
    return;
  }

  for (const store of stores.values()) {
    store.requestSync();
  }
}

interface NotesProviderProps extends PropsWithChildren {
  noteId?: string;
  containerId?: string | null;
  documentId?: string | null;
  onPersistedNote?: PersistedNoteListener;
}

export function NotesProvider({
  children,
  noteId = DEFAULT_NOTE_ID,
  containerId,
  documentId = null,
  onPersistedNote,
}: NotesProviderProps) {
  const appData = useAppData();
  const runtime = useMemo(
    () =>
      containerId === undefined
        ? appData
        : {
            ...appData,
            containerId,
          },
    [appData, containerId],
  );
  const store = useMemo(
    () =>
      getOrCreateNotesStore(
        runtime.domainScope,
        noteId,
        runtime,
        onPersistedNote,
        documentId,
      ),
    [documentId, noteId, onPersistedNote, runtime.domainScope],
  );

  useEffect(() => {
    store.updateRuntime(runtime);
  }, [store, runtime]);

  useEffect(() => {
    store.requestSync();
  }, [
    runtime.encapsulationKeyPair,
    runtime.isAuthenticated,
    runtime.online,
    store,
  ]);

  return (
    <NotesContext.Provider value={store}>{children}</NotesContext.Provider>
  );
}

export function useNotes(): NotesContextValue {
  const store = useContext(NotesContext);
  if (!store) {
    throw new Error("useNotes must be used within a NotesProvider.");
  }

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  return useMemo(
    () => ({
      attachments: snapshot.attachments,
      attachmentStorageKeyBySlotId: snapshot.attachmentStorageKeyBySlotId,
      attachFiles: store.attachFiles,
      canAttach: snapshot.canAttach,
      documentId: snapshot.documentId,
      ready: snapshot.ready,
      text: snapshot.text,
      syncing: snapshot.syncing,
      setText: store.setText,
    }),
    [snapshot, store],
  );
}
