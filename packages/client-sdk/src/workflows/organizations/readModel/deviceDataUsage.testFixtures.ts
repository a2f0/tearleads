import { ensureContainerTables } from "../../../data/persistence/container-contents/containerPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import {
  containers,
  documentAttachmentBlobProjection,
  documentPendingAttachments,
  dormantContainerMetadata,
  organizationReadModelTables,
} from "../../../data/sqlite/schema";
import {
  documentProjection,
  documentProjectionText,
} from "../../../data/sqlite/schema/documentProjectionSchema";
import {
  documentHistoryCheckpoints,
  documentHistoryUpdates,
  documents,
} from "../../../data/sqlite/schema/documentRecordSchema";
import {
  organizationReadModelDirectoryUsers,
  organizationReadModelState,
} from "../../../data/sqlite/schema/organizationReadModelSchema";
import {
  type ClientSQLiteDatabase,
  getClientSQLitePersistenceRuntime,
} from "../../../data/sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../../data/sqlite/sqlSchema";

const AT = "2026-11-07T12:00:00.000Z";

/**
 * One document with exactly the given stored columns. `kind` defaults to a
 * note; a folder's metadata document is `appKind: "container-metadata"` keyed
 * by its container id, with no projection row.
 */
interface DeviceUsageDocument {
  readonly appKind?: "container-metadata" | "documents";
  readonly checkpoint?: string;
  readonly containerId?: string | null;
  readonly contentKeyBundle?: string;
  readonly documentId?: string | null;
  readonly kekTargets?: string;
  readonly kind?: string;
  readonly localId: string;
  readonly manifest?: string;
  readonly projectedOrganizationId?: string | null;
  readonly text?: string;
  readonly updates?: ReadonlyArray<string>;
}

interface DeviceUsageFile {
  readonly byteLength: number;
  readonly localId: string;
  readonly slotId: string;
  readonly storageKey: string;
}

interface DeviceUsageHeldFile extends DeviceUsageFile {
  readonly detached?: boolean;
}

interface RosterProfileInput {
  readonly organizationId: string;
  readonly profileDocumentId: string;
  readonly userId: string;
}

interface OrganizationProfileInput {
  readonly organizationId: string;
  readonly profileDocumentId: string;
}

interface DocumentScope {
  readonly appKind: "container-metadata" | "documents";
  readonly localId: string;
}

let updateSequence = 0;

async function insertContainer(
  db: ClientSQLiteDatabase,
  id: string,
  organizationId: string,
) {
  await db
    .insert(containers)
    .values({ id, localCreatedAt: AT, localUpdatedAt: AT, organizationId })
    .run();
}

async function insertDormantMetadata(
  db: ClientSQLiteDatabase,
  containerId: string,
  organizationId: string,
) {
  await db
    .insert(dormantContainerMetadata)
    .values({ containerId, organizationId, retainedAt: AT })
    .run();
}

async function insertDocumentRecord(
  db: ClientSQLiteDatabase,
  scope: DocumentScope,
  input: DeviceUsageDocument,
) {
  await db
    .insert(documents)
    .values({
      ...scope,
      contentKeyBundle: input.contentKeyBundle ?? null,
      documentId: input.documentId ?? null,
      documentKekTargets: input.kekTargets ?? null,
      documentManifestBundle: input.manifest ?? null,
      updatedAt: AT,
    })
    .run();
}

async function insertCheckpoint(
  db: ClientSQLiteDatabase,
  scope: DocumentScope,
  snapshot: string,
) {
  await db
    .insert(documentHistoryCheckpoints)
    .values({
      ...scope,
      endVersionVector: "",
      revision: "1",
      snapshot,
      updatedAt: AT,
    })
    .run();
}

async function insertTail(
  db: ClientSQLiteDatabase,
  scope: DocumentScope,
  updates: ReadonlyArray<string>,
) {
  for (const updateData of updates) {
    updateSequence += 1;
    await db
      .insert(documentHistoryUpdates)
      .values({
        ...scope,
        createdAt: AT,
        id: `update-${updateSequence}`,
        origin: "remote",
        updateData,
      })
      .run();
  }
}

async function insertProjection(
  db: ClientSQLiteDatabase,
  input: DeviceUsageDocument,
) {
  await db
    .insert(documentProjection)
    .values({
      containerId: input.containerId ?? null,
      documentId: input.documentId ?? null,
      documentKind: input.kind ?? "note",
      localId: input.localId,
      organizationId: input.projectedOrganizationId ?? null,
      updatedAt: AT,
    })
    .run();
  if (input.text !== undefined) {
    await db
      .insert(documentProjectionText)
      .values({ localId: input.localId, text: input.text })
      .run();
  }
}

async function insertDocument(
  db: ClientSQLiteDatabase,
  input: DeviceUsageDocument,
) {
  const scope: DocumentScope = {
    appKind: input.appKind ?? "documents",
    localId: input.localId,
  };
  await insertDocumentRecord(db, scope, input);
  if (input.checkpoint !== undefined) {
    await insertCheckpoint(db, scope, input.checkpoint);
  }
  await insertTail(db, scope, input.updates ?? []);
  if (scope.appKind === "documents") {
    await insertProjection(db, input);
  }
}

/** Bytes staged for an upload that has not settled yet. */
async function insertPendingFile(
  db: ClientSQLiteDatabase,
  input: DeviceUsageFile,
) {
  await db
    .insert(documentPendingAttachments)
    .values({
      ...input,
      contentSha256: "sha",
      createdAt: AT,
      name: `${input.slotId}.bin`,
    })
    .run();
}

/** An attachment whose bytes this device holds, or a detach marker. */
async function insertHeldFile(
  db: ClientSQLiteDatabase,
  input: DeviceUsageHeldFile,
) {
  await db
    .insert(documentAttachmentBlobProjection)
    .values({
      byteLength: input.byteLength,
      contentSha256: "sha",
      detachedAt: input.detached ? AT : null,
      localId: input.localId,
      slotId: input.slotId,
      storageKey: input.storageKey,
      updatedAt: AT,
    })
    .run();
}

async function insertRosterProfile(
  db: ClientSQLiteDatabase,
  input: RosterProfileInput,
) {
  await db
    .insert(organizationReadModelDirectoryUsers)
    .values({
      ...input,
      createdAt: AT,
      encapsulationKeyFingerprint: "enc-fp",
      encapsulationPublicKey: "enc-key",
      isPersonalOrganizationOwner: false,
      joinedAt: AT,
      signingKeyFingerprint: "sig-fp",
      signingPublicKey: "sig-key",
      sortOrder: 0,
      status: "active",
      updatedAt: AT,
    })
    .run();
}

async function insertOrganizationProfile(
  db: ClientSQLiteDatabase,
  input: OrganizationProfileInput,
) {
  await db
    .insert(organizationReadModelState)
    .values({
      ...input,
      cursor: "cursor",
      memberGroupId: "members",
      memberGroupStateHash: "members-hash",
      organizationKeyEpoch: 1,
      organizationKeyFingerprint: "org-fp",
      organizationMemberCount: 1,
      organizationStateHash: "org-hash",
      organizationStateVersion: 1,
      updatedAt: AT,
    })
    .run();
}

/** A local store seeded through the tables the measurement reads. */
export async function createDeviceUsageStore(execSql: ExecSql) {
  await sqlDocumentsPersistence.ensureSchema(execSql);
  await ensureContainerTables(execSql);
  await ensureSqlTables(execSql, organizationReadModelTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);

  return {
    container: (id: string, organizationId: string) =>
      insertContainer(db, id, organizationId),
    document: (input: DeviceUsageDocument) => insertDocument(db, input),
    dormantMetadata: (containerId: string, organizationId: string) =>
      insertDormantMetadata(db, containerId, organizationId),
    heldFile: (input: DeviceUsageHeldFile) => insertHeldFile(db, input),
    organizationProfile: (input: OrganizationProfileInput) =>
      insertOrganizationProfile(db, input),
    pendingFile: (input: DeviceUsageFile) => insertPendingFile(db, input),
    rosterProfile: (input: RosterProfileInput) =>
      insertRosterProfile(db, input),
  };
}
