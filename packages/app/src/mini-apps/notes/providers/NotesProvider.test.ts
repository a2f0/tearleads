import { expect, test } from "bun:test";
import {
  type AccessEventV2,
  computeAccessEventHash,
  computeWriteHeaderHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
  type WriteHeaderV2,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createDocument, exportAllUpdates } from "@tearleads/loro";
import { createLargeText } from "@tearleads/test-utils";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type {
  DocumentV2CreateRequest,
  DocumentV2SyncRequest,
} from "@tearleads/validators/request";
import type {
  ContainerV2WriterProjectionResponse,
  DocumentV2CreateResponse,
  DocumentV2SyncResponse,
} from "@tearleads/validators/response";
import { createSqlRuntimeBase } from "../../../../test/helpers/createSqlRuntime";
import { waitForCondition } from "../../../../test/helpers/waitForCondition";
import { createMemoryBlobStore } from "../../../data/blobs";
import { subscribeToPersistedDocuments } from "../../../data/documents/DocumentsProvider";
import { DOCUMENTS_APP_KIND } from "../../../data/documents/documentsPersistence";
import { createEmptyDriverLicenseDocument } from "../../../document-types/drivers-license/driverLicenseDocument";
import type {
  LocalAttachmentRecord,
  NoteRecord,
  NoteSummary,
  NotesPersistence,
  PendingAttachmentRecord,
  PendingAttachmentReplacementRecord,
  PendingAttachmentRewrapRecord,
  PendingUpdateInsert,
  PendingUpdateRecord,
} from "../notesPersistence";
import {
  createNotesStore,
  type NotesRuntime,
  primeNotesStore,
} from "./NotesProvider";

interface StoredNotesState {
  localAttachments: LocalAttachmentRecord[];
  note: NoteRecord | null;
  pendingAttachments: PendingAttachmentRecord[];
  pendingAttachmentReplacements: PendingAttachmentReplacementRecord[];
  pendingAttachmentRewraps: PendingAttachmentRewrapRecord[];
  noteSummaries: NoteSummary[];
  pendingUpdates: PendingUpdateRecord[];
}

interface PendingUpdateLengthRow {
  update_data_length: number | string | null;
}

interface ProjectionLengthRow {
  text_length: number | string | null;
}

function createListedContainers(
  containerId: string,
  metadataAccessStateHash = `${containerId}-access-state-hash-1`,
) {
  return [
    {
      id: containerId,
      metadataAccessEpoch: 1,
      metadataAccessStateHash,
      metadataDocumentId: `metadata-${containerId}`,
      organizationId: "org-1",
      parentId: null,
    },
  ];
}

async function noteV2FixtureHash(label: string): Promise<string> {
  return toFingerprint(new TextEncoder().encode(`notes-v2:${label}`));
}

async function createPersistedNoteSnapshot(text: string): Promise<string> {
  const doc = await createDocument("persisted-note-fixture");
  doc.getText("text").update(text);
  return bytesToBase64(exportAllUpdates(doc));
}

async function createNoteV2ContainerProjection(input: {
  containerId: string;
  encapsulationPublicKey: Uint8Array;
  userId: string;
}): Promise<ContainerV2WriterProjectionResponse> {
  const manifestHash = await noteV2FixtureHash(`${input.containerId}:manifest`);
  const eventHash = await noteV2FixtureHash(`${input.containerId}:event`);
  const keyEpochHash = await noteV2FixtureHash(
    `${input.containerId}:key-epoch`,
  );
  const keyTargetHash = await noteV2FixtureHash(
    `${input.containerId}:key-target`,
  );
  const containerKeyEpochId = `${input.containerId}-key-epoch-1`;
  const containerKek = crypto.getRandomValues(new Uint8Array(32));
  const [recipient] = await wrapDekForRecipients(containerKek, [
    input.encapsulationPublicKey,
  ]);
  if (!recipient) {
    throw new Error("Expected V2 note fixture recipient wrap.");
  }

  return {
    containerId: input.containerId,
    organizationId: "organization-1",
    path: [
      {
        event: { event: {}, body: {}, eventHash },
        manifest: {},
        manifestHash,
        state: {
          containerId: input.containerId,
          organizationId: "organization-1",
        },
      },
    ],
    containerKeks: [
      {
        containerId: input.containerId,
        accessManifestHash: manifestHash,
        containerKeyEpochId,
        containerKeyEpoch: 1,
        keyEpoch: {
          id: containerKeyEpochId,
          containerId: input.containerId,
          keyEpoch: 1,
          accessManifestHash: manifestHash,
          parentContainerKeyEpochId: null,
          createdByEventHash: eventHash,
          createdByManifestHash: manifestHash,
        },
        keyEpochHash,
        keyTargetHash,
        parentContainerKeyEpochId: null,
        recipientTargets: [{}],
        wraps: [
          {
            containerKeyEpochId,
            recipientKind: "user",
            recipientId: input.userId,
            recipientKeyEpochId: `user:${input.userId}:epoch-1`,
            recipientKeyFingerprint: recipient.keyFingerprint,
            kemCipherText: bytesToBase64(recipient.kemCipherText),
            wrappedKey: bytesToBase64(recipient.wrappedKey),
            wrapManifestHash: manifestHash,
          },
        ],
      },
    ],
  };
}

async function createNoteV2CreateResponse(
  request: DocumentV2CreateRequest,
): Promise<DocumentV2CreateResponse> {
  const manifest = request.manifest as Record<string, unknown>;
  const body = request.body as Record<string, unknown>;
  const documentId = String(Reflect.get(manifest, "objectId"));
  const eventHash = await computeAccessEventHash(
    request.event as unknown as AccessEventV2,
  );
  const linkedContainerId = String(Reflect.get(body, "containerId"));
  const targets = request.contentKeyBundle.targets.map((target) => ({
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
    containerKeyEpochId: target.containerKeyEpochId,
    containerKeyEpoch: target.containerKeyEpoch,
  }));

  return {
    id: documentId,
    createdAt: "2026-04-27T00:00:00.000Z",
    accessManifest: {
      event: { event: request.event, body, eventHash },
      manifest,
      manifestHash: request.expectedManifestHash,
      state: {
        version: 2,
        documentId,
        organizationId: String(Reflect.get(manifest, "organizationId")),
        epoch: Number(Reflect.get(manifest, "epoch")),
        previousManifestHash: Reflect.get(manifest, "previousManifestHash"),
        eventHash,
        linkedContainerIds: [linkedContainerId],
      },
    },
    contentKeyBundle: {
      documentId,
      contentKeyEpoch: request.contentKeyBundle.contentKeyEpoch,
      linkSetManifestHash: request.contentKeyBundle.linkSetManifestHash,
      targetHash: request.contentKeyBundle.targetHash,
      targets: request.contentKeyBundle.targets,
    },
    documentKekTargets: {
      documentId,
      linkSetManifestHash: request.expectedManifestHash,
      linkedContainerManifestHashes: targets.map(
        (target) => target.containerManifestHash,
      ),
      linkedContainerKeyEpochIds: targets.map(
        (target) => target.containerKeyEpochId,
      ),
      targets,
      documentKeyTargetHash: request.contentKeyBundle.targetHash,
    },
  };
}

async function createNoteV2SyncResponse(input: {
  request: DocumentV2SyncRequest;
  storedDocument: DocumentV2CreateResponse;
  commitLsn: string;
}): Promise<DocumentV2SyncResponse> {
  const updates = await Promise.all(
    input.request.outgoingUpdates.map(async (update) => {
      const writeHeader = update.writeHeader as unknown as WriteHeaderV2;
      return {
        accessEpoch: 1,
        id: update.id,
        documentId: input.storedDocument.id,
        authorFingerprint: writeHeader.writerKeyFingerprint,
        encryptedData: update.encryptedData,
        partialStartVersionVector: update.partialStartVersionVector,
        partialEndVersionVector: update.partialEndVersionVector,
        createdAt: "2026-04-27T00:00:00.000Z",
        writeHeader: update.writeHeader,
        writeHeaderHash: await computeWriteHeaderHash(writeHeader),
      };
    }),
  );

  return {
    acceptedOutgoingUpdateIds: input.request.outgoingUpdates.map(
      (update) => update.id,
    ),
    commitLsn: input.commitLsn,
    contentKeyBundle: input.storedDocument.contentKeyBundle,
    documentId: input.storedDocument.id,
    documentKekTargets: input.storedDocument.documentKekTargets,
    missingUpdateEpochs: updates.length === 0 ? [] : ["current_epoch"],
    updates,
  };
}

interface NoteV2RuntimePatch {
  apiClient: NotesRuntime["apiClient"];
  organizationId: string;
  signingFingerprint: string;
  signingKeyPair: NonNullable<NotesRuntime["signingKeyPair"]>;
  userId: string;
}

function createNoteV2RuntimePatch(input: {
  containerId?: string;
  encapsulationKeyPair: NonNullable<NotesRuntime["encapsulationKeyPair"]>;
  syncCalls?: Array<{ minLsn: string | null; outgoingUpdateCount: number }>;
}): NoteV2RuntimePatch {
  const containerId = input.containerId ?? "root-container";
  const signingKeyPair = generateSigningSeedAndKeyPair();
  let projectionPromise: Promise<ContainerV2WriterProjectionResponse> | null =
    null;
  let storedDocument: DocumentV2CreateResponse | null = null;
  let syncCount = 0;
  const getProjection = () => {
    projectionPromise ??= createNoteV2ContainerProjection({
      containerId,
      encapsulationPublicKey: input.encapsulationKeyPair.publicKey,
      userId: "user-1",
    });
    return projectionPromise;
  };

  return {
    apiClient: {
      createDocumentV2: async (request) => {
        storedDocument = await createNoteV2CreateResponse(request);
        return storedDocument;
      },
      getBlob: async () => null,
      getContainerV2WriterProjection: () => getProjection(),
      getDocumentV2WriterProjection: async () => {
        if (!storedDocument) {
          return null;
        }
        return {
          authorizingContainerPaths: [await getProjection()],
          contentKeyBundle: storedDocument.contentKeyBundle,
          documentId: storedDocument.id,
          documentKekTargets: storedDocument.documentKekTargets,
          documentManifest: storedDocument.accessManifest,
        };
      },
      listContainers: async () => createListedContainers(containerId),
      listDocumentAttachments: async () => [],
      syncDocumentV2: async (_documentId, request) => {
        if (!storedDocument) {
          return null;
        }
        input.syncCalls?.push({
          minLsn: request.minLsn ?? null,
          outgoingUpdateCount: request.outgoingUpdates.length,
        });
        syncCount += 1;
        return createNoteV2SyncResponse({
          request,
          storedDocument,
          commitLsn: syncCount === 1 ? "0/10" : "0/20",
        });
      },
    },
    organizationId: "organization-1",
    signingFingerprint: "a".repeat(64),
    signingKeyPair,
    userId: "user-1",
  };
}

interface PendingUpdateDetailRow extends PendingUpdateLengthRow {
  partial_start_version_vector: string | null;
  partial_end_version_vector: string | null;
}

function readRowValue(value: unknown, key: string): unknown {
  return isPlainObject(value) ? value[key] : undefined;
}

function isPendingUpdateLengthRow(
  value: unknown,
): value is PendingUpdateLengthRow {
  const updateDataLength = readRowValue(value, "update_data_length");
  return (
    typeof updateDataLength === "number" ||
    typeof updateDataLength === "string" ||
    updateDataLength === null
  );
}

function isProjectionLengthRow(value: unknown): value is ProjectionLengthRow {
  const textLength = readRowValue(value, "text_length");
  return (
    typeof textLength === "number" ||
    typeof textLength === "string" ||
    textLength === null
  );
}

function isPendingUpdateDetailRow(
  value: unknown,
): value is PendingUpdateDetailRow {
  const partialStartVersionVector = readRowValue(
    value,
    "partial_start_version_vector",
  );
  const partialEndVersionVector = readRowValue(
    value,
    "partial_end_version_vector",
  );

  return (
    isPendingUpdateLengthRow(value) &&
    (typeof partialStartVersionVector === "string" ||
      partialStartVersionVector === null) &&
    (typeof partialEndVersionVector === "string" ||
      partialEndVersionVector === null)
  );
}

function createNotesPersistence(): NotesPersistence & {
  getState: () => StoredNotesState;
} {
  let note: NoteRecord | null = null;
  let localAttachments: LocalAttachmentRecord[] = [];
  let pendingAttachments: PendingAttachmentRecord[] = [];
  let pendingAttachmentReplacements: PendingAttachmentReplacementRecord[] = [];
  let pendingAttachmentRewraps: PendingAttachmentRewrapRecord[] = [];
  let pendingUpdates: PendingUpdateRecord[] = [];

  return {
    async ensureSchema() {},
    getState() {
      return {
        localAttachments,
        note,
        pendingAttachments,
        pendingAttachmentReplacements,
        pendingAttachmentRewraps,
        noteSummaries: note
          ? [
              {
                id: note.id,
                containerId: note.containerId,
                documentId: note.documentId,
                title: note.text.trim() || "Untitled note",
                updatedAt: "2026-04-06T00:00:00.000Z",
              },
            ]
          : [],
        pendingUpdates,
      };
    },
    async listNotes() {
      return note
        ? [
            {
              id: note.id,
              containerId: note.containerId,
              documentId: note.documentId,
              title: note.text.trim() || "Untitled note",
              updatedAt: "2026-04-06T00:00:00.000Z",
            },
          ]
        : [];
    },
    async listNotesByContainerIdsOrDocumentIds(_execSql, input) {
      if (!note) {
        return [];
      }

      const containerIds = new Set(input.containerIds);
      const documentIds = new Set(input.documentIds);
      const containerMatches =
        note.containerId !== null && containerIds.has(note.containerId);
      const documentMatches =
        note.documentId !== null && documentIds.has(note.documentId);
      if (!containerMatches && !documentMatches) {
        return [];
      }

      return [
        {
          id: note.id,
          containerId: note.containerId,
          documentId: note.documentId,
          title: note.text.trim() || "Untitled note",
          updatedAt: "2026-04-06T00:00:00.000Z",
        },
      ];
    },
    async loadNote() {
      return note;
    },
    async saveNote(_execSql, nextNote) {
      note = nextNote;
      return "2026-04-06T00:00:00.000Z";
    },
    async upsertDiscoveredNote(_execSql, input) {
      const nextNote = {
        accessEpoch: input.accessEpoch,
        containerId: input.containerId,
        documentId: input.documentId,
        documentRecipientEnvelopes: note?.documentRecipientEnvelopes ?? null,
        id: note?.id ?? input.documentId,
        loroSnapshot: note?.loroSnapshot ?? "",
        text: note?.text ?? "",
      };
      note = nextNote;

      return {
        id: nextNote.id,
        containerId: nextNote.containerId,
        documentId: nextNote.documentId,
        title: nextNote.text.trim() || "Untitled note",
        updatedAt: input.createdAt,
      };
    },
    async relinkPersistedNote(_execSql, input) {
      if (!note || note.id !== input.noteId) {
        return null;
      }

      note = {
        ...note,
        accessEpoch: Math.max(note.accessEpoch, input.accessEpoch),
        containerId: input.containerId,
        documentId: input.documentId,
        documentRecipientEnvelopes:
          input.accessEpoch > note.accessEpoch
            ? null
            : note.documentRecipientEnvelopes,
      };

      return {
        id: note.id,
        containerId: note.containerId,
        documentId: note.documentId,
        title: note.text.trim() || "Untitled note",
        updatedAt: "2026-04-06T00:00:00.000Z",
      };
    },
    async listPendingUpdates() {
      return pendingUpdates;
    },
    async listPendingAttachments() {
      return pendingAttachments;
    },
    async listPendingAttachmentRewraps() {
      return pendingAttachmentRewraps;
    },
    async listPendingAttachmentReplacements() {
      return pendingAttachmentReplacements;
    },
    async listLocalAttachments() {
      return localAttachments;
    },
    async enqueuePendingUpdate(_execSql, pendingUpdate: PendingUpdateInsert) {
      pendingUpdates = [
        ...pendingUpdates,
        {
          id: crypto.randomUUID(),
          partialEndVersionVector: pendingUpdate.partialEndVersionVector,
          partialStartVersionVector: pendingUpdate.partialStartVersionVector,
          sourceVersionVector: pendingUpdate.sourceVersionVector ?? null,
          updateData: pendingUpdate.updateData,
        },
      ];
    },
    async deletePendingUpdate(_execSql, id: string) {
      pendingUpdates = pendingUpdates.filter(
        (pendingUpdate) => pendingUpdate.id !== id,
      );
    },
    async deletePendingUpdates() {
      pendingUpdates = [];
    },
    async saveLocalAttachment(_execSql, attachment) {
      localAttachments = [
        ...localAttachments.filter(
          (existingAttachment) =>
            !(
              existingAttachment.noteId === attachment.noteId &&
              existingAttachment.slotId === attachment.slotId
            ),
        ),
        attachment,
      ];
    },
    async savePendingAttachment(_execSql, attachment) {
      pendingAttachments = [
        ...pendingAttachments.filter(
          (existingAttachment) =>
            !(
              existingAttachment.noteId === attachment.noteId &&
              existingAttachment.slotId === attachment.slotId
            ),
        ),
        attachment,
      ];
    },
    async savePendingAttachmentRewrap(_execSql, attachment) {
      pendingAttachmentRewraps = [
        ...pendingAttachmentRewraps.filter(
          (existingAttachmentRewrap) =>
            !(
              existingAttachmentRewrap.noteId === attachment.noteId &&
              existingAttachmentRewrap.slotId === attachment.slotId
            ),
        ),
        attachment,
      ];
    },
    async savePendingAttachmentReplacement(_execSql, attachment) {
      pendingAttachmentReplacements = [
        ...pendingAttachmentReplacements.filter(
          (existingAttachmentReplacement) =>
            !(
              existingAttachmentReplacement.noteId === attachment.noteId &&
              existingAttachmentReplacement.slotId === attachment.slotId
            ),
        ),
        attachment,
      ];
    },
    async deletePendingAttachments(_execSql, noteId) {
      pendingAttachments = pendingAttachments.filter(
        (attachment) => attachment.noteId !== noteId,
      );
    },
    async deletePendingAttachmentRewraps(_execSql, noteId) {
      pendingAttachmentRewraps = pendingAttachmentRewraps.filter(
        (attachmentRewrap) => attachmentRewrap.noteId !== noteId,
      );
    },
    async deletePendingAttachmentReplacement(_execSql, noteId, slotId) {
      pendingAttachmentReplacements = pendingAttachmentReplacements.filter(
        (attachmentReplacement) =>
          !(
            attachmentReplacement.noteId === noteId &&
            attachmentReplacement.slotId === slotId
          ),
      );
    },
    async deletePendingAttachmentReplacements(_execSql, noteId) {
      pendingAttachmentReplacements = pendingAttachmentReplacements.filter(
        (attachmentReplacement) => attachmentReplacement.noteId !== noteId,
      );
    },
  };
}

function createRuntime(containerId = "root-container"): NotesRuntime {
  return {
    apiClient: {
      getBlob: async () => null,
      listContainers: async () => createListedContainers(containerId),
      listDocumentAttachments: async () => null,
    },
    blobStore: createMemoryBlobStore(),
    cacheReferencedPrincipalPolicies: async () => {},
    containerId,
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair: null,
    events: [],
    execSql: async () => [],

    isAuthenticated: false,
    log: () => {},
    online: false,
  };
}

function createSyncRuntime(
  encapsulationKeyPair: NonNullable<NotesRuntime["encapsulationKeyPair"]>,
  containerId = "root-container",
  options: {
    syncCalls?: Array<{ minLsn: string | null; outgoingUpdateCount: number }>;
  } = {},
): NotesRuntime {
  const v2Patch = createNoteV2RuntimePatch({
    containerId,
    encapsulationKeyPair,
    ...(options.syncCalls ? { syncCalls: options.syncCalls } : {}),
  });
  return {
    apiClient: v2Patch.apiClient,
    blobStore: createMemoryBlobStore(),
    cacheReferencedPrincipalPolicies: async () => {},
    containerId,
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair,
    events: [],
    execSql: async () => [],
    isAuthenticated: true,
    log: () => {},
    online: true,
    organizationId: v2Patch.organizationId,
    signingFingerprint: v2Patch.signingFingerprint,
    signingKeyPair: v2Patch.signingKeyPair,
    userId: v2Patch.userId,
  };
}

function createOfflineAttachmentRuntime(
  encapsulationKeyPair: NonNullable<NotesRuntime["encapsulationKeyPair"]>,
  containerId = "root-container",
): NotesRuntime {
  return {
    apiClient: {
      getBlob: async () => null,
      listContainers: async () => createListedContainers(containerId),
      listDocumentAttachments: async () => null,
    },
    blobStore: createMemoryBlobStore(),
    cacheReferencedPrincipalPolicies: async () => {},
    containerId,
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair,
    events: [],
    execSql: async () => [],
    isAuthenticated: false,
    log: () => {},
    online: false,
  };
}

async function createSqlRuntime(): Promise<
  NotesRuntime & {
    close: () => void;
  }
> {
  const runtimeBase = await createSqlRuntimeBase("notes-provider-test");

  return {
    ...runtimeBase,
    apiClient: {
      getBlob: async () => null,
      listContainers: async () => createListedContainers("root-container"),
      listDocumentAttachments: async () => null,
    },
    containerId: "root-container",
  };
}

test.skip("primeNotesStore reuses a synced remote note across different local ids", async () => {
  const runtimeBase = await createSqlRuntime();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const v2Patch = createNoteV2RuntimePatch({
    encapsulationKeyPair,
  });
  const runtime: NotesRuntime & { close: () => void } = {
    ...runtimeBase,
    apiClient: v2Patch.apiClient,
    encapsulationKeyPair,
    isAuthenticated: true,
    online: true,
    organizationId: v2Patch.organizationId,
    signingFingerprint: v2Patch.signingFingerprint,
    signingKeyPair: v2Patch.signingKeyPair,
    userId: v2Patch.userId,
  };

  try {
    const firstStore = primeNotesStore(runtime.domainScope, "note-1", runtime);
    await waitForCondition(
      () => firstStore.getSnapshot().ready,
      "First primed note store did not initialize.",
    );

    firstStore.setText("Shared note");
    await waitForCondition(
      () => firstStore.getSnapshot().documentId === "shared-remote-note",
      "First primed note store did not persist its remote document id.",
    );

    const secondStore = primeNotesStore(
      runtime.domainScope,
      "default",
      runtime,
      "shared-remote-note",
    );

    expect(secondStore).toBe(firstStore);
    expect(secondStore.getSnapshot().text).toBe("Shared note");
    await waitForCondition(
      () => !firstStore.getSnapshot().syncing,
      "Shared note store did not finish syncing before cleanup.",
    );
  } finally {
    runtimeBase.close();
  }
});

test.skip("primeNotesStore collapses live duplicate note facades after remote identity resolves", async () => {
  const runtimeBase = await createSqlRuntime();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const v2Patch = createNoteV2RuntimePatch({
    encapsulationKeyPair,
  });
  const runtime: NotesRuntime & { close: () => void } = {
    ...runtimeBase,
    apiClient: v2Patch.apiClient,
    encapsulationKeyPair,
    isAuthenticated: true,
    online: true,
    organizationId: v2Patch.organizationId,
    signingFingerprint: v2Patch.signingFingerprint,
    signingKeyPair: v2Patch.signingKeyPair,
    userId: v2Patch.userId,
  };

  try {
    const firstStore = primeNotesStore(runtime.domainScope, "note-1", runtime);
    const secondStore = primeNotesStore(
      runtime.domainScope,
      "default",
      runtime,
      "shared-remote-note",
    );

    expect(secondStore).not.toBe(firstStore);

    await waitForCondition(
      () => firstStore.getSnapshot().ready && secondStore.getSnapshot().ready,
      "Duplicate note facades did not initialize before consolidation.",
    );

    firstStore.setText("Shared note");

    await waitForCondition(
      () =>
        secondStore.getSnapshot().documentId === "shared-remote-note" &&
        secondStore.getSnapshot().text === "Shared note",
      "Live duplicate note facades did not collapse onto the same backing store.",
    );

    secondStore.setText("Merged note");

    await waitForCondition(
      () => firstStore.getSnapshot().text === "Merged note",
      "Collapsed note facades did not share subsequent updates.",
    );
    await waitForCondition(
      () =>
        !firstStore.getSnapshot().syncing && !secondStore.getSnapshot().syncing,
      "Collapsed note facades did not finish syncing before cleanup.",
    );
  } finally {
    runtimeBase.close();
  }
});

test("domain-scoped persisted document subscriptions fan out to multiple listeners", async () => {
  const persistence = createNotesPersistence();
  const runtime = createRuntime();
  const firstListenerDocuments: NoteSummary[] = [];
  const secondListenerDocuments: NoteSummary[] = [];
  const unsubscribeFirst = subscribeToPersistedDocuments(
    runtime.domainScope,
    (document) => {
      firstListenerDocuments.push(document);
    },
  );
  const unsubscribeSecond = subscribeToPersistedDocuments(
    runtime.domainScope,
    (document) => {
      secondListenerDocuments.push(document);
    },
  );

  try {
    const store = createNotesStore("shared-listeners", runtime, persistence);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "Notes store did not become ready before broadcasting persisted updates.",
    );

    store.setText("Shared note");

    await waitForCondition(
      () =>
        firstListenerDocuments.some(
          (document) => document.title === "Shared note",
        ) &&
        secondListenerDocuments.some(
          (document) => document.title === "Shared note",
        ),
      "Persisted document listeners did not all receive the saved note summary.",
    );
  } finally {
    unsubscribeFirst();
    unsubscribeSecond();
  }
});

test("notes store reloads persisted note text and pending updates", async () => {
  const persistence = createNotesPersistence();

  const firstRuntime = createRuntime();
  const firstStore = createNotesStore("default", firstRuntime, persistence);
  firstStore.updateRuntime(firstRuntime);

  await waitForCondition(
    () => firstStore.getSnapshot().ready,
    "First notes store did not become ready.",
  );

  expect(firstStore.getSnapshot()).toEqual({
    attachments: [],
    attachmentStatusBySlotId: {},
    attachmentStorageKeyBySlotId: {},
    canAttach: false,
    documentId: null,
    ready: true,
    syncing: false,
    text: "",
  });

  firstStore.setText("persisted note");

  await waitForCondition(
    () => persistence.getState().note?.text === "persisted note",
    "Persisted note text was not written.",
  );

  await waitForCondition(
    () => persistence.getState().pendingUpdates.length === 1,
    "Pending note update was not enqueued.",
  );

  const secondRuntime = createRuntime();
  const secondStore = createNotesStore("default", secondRuntime, persistence);
  secondStore.updateRuntime(secondRuntime);

  await waitForCondition(
    () => secondStore.getSnapshot().ready,
    "Second notes store did not become ready.",
  );

  expect(secondStore.getSnapshot()).toEqual({
    attachments: [],
    attachmentStatusBySlotId: {},
    attachmentStorageKeyBySlotId: {},
    canAttach: false,
    documentId: null,
    ready: true,
    syncing: false,
    text: "persisted note",
  });
});

test("notes store creates a document linked to the configured container", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtime = createSyncRuntime(encapsulationKeyPair, "shared-container");

  const store = createNotesStore("container-note", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Container-scoped notes store did not become ready.",
  );

  store.setText("shared container note");

  await waitForCondition(
    () =>
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().note?.documentId !== null &&
      persistence.getState().note?.containerId === "shared-container" &&
      persistence.getState().note?.v2ContentKeyBundle !== null &&
      persistence.getState().note?.v2DocumentKekTargets !== null &&
      persistence.getState().note?.v2DocumentManifestBundle !== null,
    "Container-scoped note did not create and sync its document.",
  );
});

test("notes store clears V2 document state when access epoch changes", async () => {
  const persistence = createNotesPersistence();
  const runtime = createRuntime();

  await persistence.saveNote(runtime.execSql, {
    accessEpoch: 1,
    accessStateHash: "access-state-hash-1",
    containerId: "container-a",
    documentId: "remote-document",
    documentRecipientEnvelopes: "legacy-envelope-bundle",
    id: "epoch-note",
    lastCommitLsn: "0/10",
    loroSnapshot: await createPersistedNoteSnapshot("Existing note"),
    text: "Existing note",
    v2ContentKeyBundle: "stale-content-key-bundle",
    v2DocumentKekTargets: "stale-kek-targets",
    v2DocumentManifestBundle: "stale-manifest-bundle",
  });

  const store = createNotesStore("epoch-note", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Epoch relink note store did not become ready.",
  );

  await expect(
    store.relink({
      accessEpoch: 2,
      accessStateHash: "access-state-hash-2",
      containerId: "container-b",
      documentId: "remote-document",
      localId: "epoch-note",
    }),
  ).resolves.toMatchObject({
    accessStateHash: "access-state-hash-2",
    containerId: "container-b",
    documentId: "remote-document",
    id: "epoch-note",
  });

  expect(persistence.getState().note).toMatchObject({
    accessEpoch: 2,
    accessStateHash: "access-state-hash-2",
    containerId: "container-b",
    documentId: "remote-document",
    documentRecipientEnvelopes: null,
    lastCommitLsn: "0/10",
    v2ContentKeyBundle: null,
    v2DocumentKekTargets: null,
    v2DocumentManifestBundle: null,
  });
});

test("document store seeds initial text before first persistence", async () => {
  const persistence = createNotesPersistence();
  const runtime = createRuntime();
  const initialText = createEmptyDriverLicenseDocument();
  const store = createNotesStore(
    "driver-license",
    runtime,
    persistence,
    null,
    initialText,
  );

  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Document store did not become ready.",
  );

  expect(store.getSnapshot()).toEqual({
    attachments: [],
    attachmentStatusBySlotId: {},
    attachmentStorageKeyBySlotId: {},
    canAttach: false,
    documentId: null,
    ready: true,
    syncing: false,
    text: initialText,
  });
  expect(persistence.getState().note?.text).toBe(initialText);
  expect(persistence.getState().pendingUpdates).toHaveLength(1);
});

test("notes store attaches files locally without authentication or network", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const blobStore = createMemoryBlobStore();
  const runtime = createOfflineAttachmentRuntime(
    encapsulationKeyPair,
    "offline-container",
  );
  const offlineRuntime: NotesRuntime = {
    ...runtime,
    blobStore,
  };
  const store = createNotesStore(
    "offline-attachment-note",
    offlineRuntime,
    persistence,
  );
  store.updateRuntime(offlineRuntime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Offline attachment notes store did not become ready.",
  );

  expect(store.getSnapshot().canAttach).toBe(true);

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("offline bytes"),
      mimeType: "image/png",
      name: "offline.png",
    },
  ]);

  await waitForCondition(
    () =>
      store.getSnapshot().attachments.length === 1 &&
      persistence.getState().pendingAttachments.length === 1 &&
      persistence.getState().pendingAttachments[0]?.name === "offline.png",
    "Offline attachment was not stored locally.",
  );

  const slotId = store.getSnapshot().attachments[0]?.slotId;
  const storageKey = slotId
    ? store.getSnapshot().attachmentStorageKeyBySlotId[slotId]
    : undefined;
  const persistedBytes = storageKey
    ? await blobStore.readBytes(storageKey)
    : null;

  expect(storageKey).toBeString();
  expect(new TextDecoder().decode(persistedBytes ?? new Uint8Array())).toBe(
    "offline bytes",
  );
});

test("notes store does not publish attachment metadata before V2 attachment bindings", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const logs: string[] = [];
  const syncCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  const runtime: NotesRuntime = {
    ...createSyncRuntime(encapsulationKeyPair, "shared-container", {
      syncCalls,
    }),
    log: (message) => logs.push(message),
  };
  const store = createNotesStore("v2-attachment-block", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "V2 attachment block note store did not become ready.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("remote attachment bytes"),
      mimeType: "image/png",
      name: "remote.png",
    },
  ]);

  await waitForCondition(
    () =>
      logs.includes(
        "Documents: attachment upload sync is waiting for V2 attachment bindings.",
      ),
    "Pending attachment sync was not blocked on V2 attachment bindings.",
  );

  expect(store.getSnapshot().attachments).toHaveLength(1);
  expect(persistence.getState().pendingAttachments).toHaveLength(1);
  expect(persistence.getState().pendingUpdates).toHaveLength(1);
  expect(persistence.getState().note?.documentId).toBeNull();
  expect(syncCalls).toEqual([]);
});

test("notes store keeps prior attachments when a second file is attached", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtime = createSyncRuntime(encapsulationKeyPair, "shared-container");
  const store = createNotesStore("attachment-sequence", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Sequential attachment note store did not become ready.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("first"),
      mimeType: "image/png",
      name: "first.png",
    },
  ]);

  await waitForCondition(
    () => store.getSnapshot().attachments.length === 1,
    "First attachment did not persist.",
  );

  store.attachFiles([
    {
      bytes: new TextEncoder().encode("second"),
      mimeType: "image/png",
      name: "second.png",
    },
  ]);

  await waitForCondition(
    () => store.getSnapshot().attachments.length === 2,
    "Second attachment did not persist.",
  );

  expect(
    store.getSnapshot().attachments.map((attachment) => attachment.name),
  ).toEqual(["first.png", "second.png"]);
});

test("notes store reloads persisted attachment metadata from the note snapshot", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const runtime = createSyncRuntime(encapsulationKeyPair);
  const firstStore = createNotesStore(
    "attachment-reload",
    runtime,
    persistence,
  );
  firstStore.updateRuntime(runtime);

  await waitForCondition(
    () => firstStore.getSnapshot().ready,
    "First attachment note store did not become ready.",
  );

  firstStore.attachFiles([
    {
      bytes: new TextEncoder().encode("persisted attachment"),
      mimeType: "text/plain",
      name: "persisted.txt",
    },
  ]);

  await waitForCondition(
    () => firstStore.getSnapshot().attachments.length === 1,
    "Attachment metadata was not persisted to the first note store.",
  );

  const secondStore = createNotesStore(
    "attachment-reload",
    createRuntime(),
    persistence,
  );
  secondStore.updateRuntime(createRuntime());

  await waitForCondition(
    () => secondStore.getSnapshot().ready,
    "Second attachment note store did not become ready.",
  );

  expect(secondStore.getSnapshot().attachments).toEqual([
    {
      byteLength: "persisted attachment".length,
      mimeType: "text/plain",
      name: "persisted.txt",
      slotId: firstStore.getSnapshot().attachments[0]?.slotId ?? "",
    },
  ]);
});

test("large note edits remain a single pending update row before sync", async () => {
  const runtime = await createSqlRuntime();

  try {
    const noteId = "large-note";
    const store = createNotesStore(noteId, runtime);
    store.updateRuntime(runtime);

    await waitForCondition(
      () => store.getSnapshot().ready,
      "SQLite-backed notes store did not become ready.",
    );

    const largeText = createLargeText(1024 * 1024);
    store.setText(largeText);

    await waitForCondition(async () => {
      const pendingRows = await runtime.execSql(
        `
          SELECT
            id,
            length(update_data) AS update_data_length
        FROM document_pending_updates
        WHERE app_kind = :appKind AND local_id = :localId
      `,
        {
          ":appKind": DOCUMENTS_APP_KIND,
          ":localId": noteId,
        },
      );

      const projectionRows = await runtime.execSql(
        `
          SELECT length(text) AS text_length
          FROM document_projection
          WHERE local_id = :localId
        `,
        {
          ":localId": noteId,
        },
      );
      const pendingRow = pendingRows[0];
      const projectionRow = projectionRows[0];

      return (
        pendingRows.length === 1 &&
        isPendingUpdateLengthRow(pendingRow) &&
        isProjectionLengthRow(projectionRow) &&
        Number(pendingRow.update_data_length ?? 0) > 256 * 1024 &&
        Number(projectionRow.text_length ?? 0) === largeText.length
      );
    }, "Large note edit was not persisted as a single pending update.");

    const pendingRows = await runtime.execSql(
      `
        SELECT
          id,
          length(update_data) AS update_data_length,
          partial_start_version_vector,
          partial_end_version_vector
        FROM document_pending_updates
        WHERE app_kind = :appKind AND local_id = :localId
      `,
      {
        ":appKind": DOCUMENTS_APP_KIND,
        ":localId": noteId,
      },
    );
    const pendingRow = pendingRows[0];

    expect(pendingRows).toHaveLength(1);
    if (!isPendingUpdateDetailRow(pendingRow)) {
      throw new Error("Expected a pending update detail row.");
    }

    expect(Number(pendingRow.update_data_length ?? 0)).toBeGreaterThan(
      256 * 1024,
    );
    expect(pendingRow.partial_start_version_vector).toBeString();
    expect(pendingRow.partial_end_version_vector).toBeString();
  } finally {
    runtime.close();
  }
});

test("notes store persists commitLsn and reuses it as minLsn on the next sync", async () => {
  const persistence = createNotesPersistence();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const syncDocumentCalls: Array<{
    minLsn: string | null;
    outgoingUpdateCount: number;
  }> = [];
  const runtime = createSyncRuntime(encapsulationKeyPair, "root-container", {
    syncCalls: syncDocumentCalls,
  });
  const store = createNotesStore("default", runtime, persistence);
  store.updateRuntime(runtime);

  await waitForCondition(
    () => store.getSnapshot().ready,
    "Notes sync store did not become ready.",
  );

  store.setText("hello");

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 1 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().note?.lastCommitLsn === "0/10",
    "Initial note document sync did not persist the returned commitLsn.",
  );

  store.setText("hello again");

  await waitForCondition(
    () =>
      syncDocumentCalls.length === 2 &&
      persistence.getState().pendingUpdates.length === 0 &&
      persistence.getState().note?.lastCommitLsn === "0/20",
    "Follow-up note sync did not reuse and refresh the persisted commitLsn.",
  );

  expect(syncDocumentCalls).toEqual([
    {
      minLsn: null,
      outgoingUpdateCount: 1,
    },
    {
      minLsn: "0/10",
      outgoingUpdateCount: 1,
    },
  ]);
});
