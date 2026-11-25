import { afterEach, expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createSyncResponse } from "../../../../test/helpers/data/documentFixtures";
import { createMaterializedSyncFixture } from "../../../../test/helpers/workflows/materializedSyncFixture";
import { createOnlineDocumentsRuntime } from "../../../../test/helpers/workflows/onlineDocumentStoreFixtures";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import { documentVerdictJudge } from "../../../data/documents/shared/sync/documentUpdateVerdict";
import {
  type ContainerContentsPersistence,
  sqlContainerContentsPersistence,
} from "../../../data/persistence/container-contents/containerContentsPersistence";
import { ensureDocumentTables } from "../../../data/persistence/documents/records";
import { readRecordedImportVoids } from "../../../data/persistence/documents/records/documentSyncVerdictPersistence";
import { createDomainScope } from "../../../data/shared/domainScope";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { buildMaterializedDocumentSyncPlan } from "../../documents/syncPlan/syncPlanMaterial";
import { createPrincipalPolicyOperation } from "../../principals/principalPolicyService";
import {
  createWriterContainerMetadataDocument,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "./containerMetadataDocument";
import {
  installContainerMetadataRecord,
  renameContainerMetadataStateFromRuntime,
  syncContainerMetadataState,
} from "./index";
import {
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import {
  createDetachedContainerMetadataState,
  installDetachedContainerMetadataState,
} from "./metadataStateIsolation";
import { containerMetadataScope } from "./metadataSyncVerdicts";
import type { ContainerMetadataState } from "./metadataTypes";

const CONTAINER_ID = "metadata-writer-peer-page";
const closers: (() => void)[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/**
 * A stored container whose live metadata this device wrote under its writer
 * peer, and a server that serves one update another holder of that peer
 * committed at the peer's next counters. `hooks` run the racing local edit
 * inside the pass: while the server answers, or while the pass saves its page.
 */
async function createForgedWriterPeerSync() {
  const fixture = await createMaterializedSyncFixture();
  const { documentId } = fixture.writerProjection;
  const database = await createTestExecSql(
    `writer-peer-${crypto.randomUUID()}`,
  );
  const server = await createTestExecSql(`server-${crypto.randomUUID()}`);
  closers.push(database.close, server.close);
  await ensureDocumentTables(server.execSql);
  const { execSql } = database;
  const doc = await createWriterContainerMetadataDocument(CONTAINER_ID, {
    auth: { userId: fixture.author.signerUserId },
    state: { domainScope: createDomainScope() },
  });
  writeContainerMetadataValue(doc, { icon: null, name: "Before" });
  const writerPeer = doc.peerIdStr;

  const forger = await createDocument("metadata-writer-peer-page-forger");
  importSnapshot(forger, exportFullHistorySnapshot(doc));
  const before = encodeVersionVector(forger);
  forger.setPeerId(writerPeer);
  forger.getMap("container").set("icon", "forged");
  forger.commit();
  const forgedFields = createPendingUpdateFields(
    exportUpdatesSince(forger, before),
  );
  forger.free();
  if (!forgedFields) throw new Error("Expected a forged metadata update");
  const forged = { id: crypto.randomUUID(), ...forgedFields };

  const container = createContainerRecord({
    id: CONTAINER_ID,
    metadataDocumentId: documentId,
    name: "Before",
    parentId: null,
  });
  const record = createDocumentRecord({
    contentKeyBundle: JSON.stringify(fixture.writerProjection.contentKeyBundle),
    documentId,
    documentKekTargets: JSON.stringify(
      fixture.writerProjection.documentKekTargets,
    ),
    documentManifestBundle: JSON.stringify(
      fixture.writerProjection.documentManifest,
    ),
    id: container.id,
    lastCommitLsn: "0/1",
    metadataUpdates: bytesToBase64(exportAllUpdates(doc)),
  });
  await sqlContainerContentsPersistence.ensureSchema(execSql);
  await sqlContainerContentsPersistence.saveContainer(
    execSql,
    container,
    record,
  );
  const live: ContainerMetadataState = { container, doc, record };
  const hooks: { whileServing: (() => Promise<void>) | undefined } = {
    whileServing: undefined,
  };
  const logs: string[] = [];
  const apiClient = createMockApiClient({
    getDocumentWriterProjection: async () => fixture.writerProjection,
    syncDocumentResult: async (_documentId, request) => {
      const whileServing = hooks.whileServing;
      hooks.whileServing = undefined;
      await whileServing?.();
      const materialized = await buildMaterializedDocumentSyncPlan({
        author: fixture.author,
        execSql: server.execSql,
        localVersionVector: null,
        pendingUpdates: [forged],
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        targetSecretKey: fixture.secretKey,
        writerProjection: fixture.writerProjection,
      });
      const data = await createSyncResponse(materialized.plan, {
        acceptedOutgoingUpdateIds: request.outgoingUpdates.map(
          (update) => update.id,
        ),
        commitLsn: "0/2",
      });
      return { data, ok: true };
    },
  });
  const runtime = createOnlineDocumentsRuntime({ apiClient, execSql, fixture });
  const syncRuntime = {
    ...runtime,
    util: { ...runtime.util, log: (line: string) => logs.push(line) },
  };

  /** The stored metadata, as a reload would read it. */
  async function durable() {
    const stored =
      await sqlContainerContentsPersistence.loadContainerMetadataState(
        execSql,
        CONTAINER_ID,
      );
    if (!stored?.record) throw new Error("Expected stored metadata");
    const reloaded = await createDocument("metadata-writer-peer-page-reload");
    importUpdates(reloaded, [base64ToBytes(stored.record.metadataUpdates)]);
    const state = {
      name: stored.container.name,
      value: readContainerMetadataValue(reloaded, "fallback"),
      version: encodeVersionVector(reloaded),
    };
    reloaded.free();
    return state;
  }

  return {
    durable,
    forgedId: forged.id,
    hooks,
    live,
    liveValue: () => ({
      name: live.container.name,
      value: readContainerMetadataValue(live.doc, "fallback"),
      version: encodeVersionVector(live.doc),
    }),
    logs,
    pending: () =>
      sqlContainerContentsPersistence.listPendingUpdates(execSql, CONTAINER_ID),
    /** As the store's rename does: edit a copy, save it, install it. */
    async rename(name: string, onWritten: () => void = () => undefined) {
      const copy = await createDetachedContainerMetadataState(live);
      const saving = renameContainerMetadataStateFromRuntime({
        metadataState: copy,
        name,
        persistence: sqlContainerContentsPersistence,
        runtime: { infra: { execSql } },
      });
      // The rename wrote its copy before its first await.
      onWritten();
      const renamed = await saving;
      if (!renamed) throw new Error("Rename was not persisted");
      copy.container = renamed.container;
      installContainerMetadataRecord(copy, renamed.record);
      installDetachedContainerMetadataState(live, copy);
      return copy.doc.peerIdStr;
    },
    sync: (
      persistence: ContainerContentsPersistence = sqlContainerContentsPersistence,
    ) =>
      syncContainerMetadataState({
        forceReadSync: true,
        isCurrent: () => true,
        metadataState: live,
        persistence,
        policyOperation: createPrincipalPolicyOperation(),
        resolveProjectionUserKey: fixture.resolveProjectionUserKey,
        runtime: syncRuntime,
        targetSecretKey: fixture.secretKey,
      }),
    voids: () =>
      readRecordedImportVoids(getClientSQLitePersistenceRuntime(execSql).db, {
        judge: documentVerdictJudge(),
        scope: containerMetadataScope(CONTAINER_ID),
        updateIds: [forged.id],
      }),
    writerPeer,
  };
}

test("a rename that lands while a pass is served a page forged on the writer peer fails the page, and the next pass voids it", async () => {
  const race = await createForgedWriterPeerSync();
  let renamePeer: string | undefined;
  race.hooks.whileServing = async () => {
    renamePeer = await race.rename("Local");
  };

  // The pass judged the page against a copy made before the rename.
  expect(await race.sync()).toBeNull();

  expect(renamePeer).toBe(race.writerPeer);
  expect(race.logs.filter((line) => line.includes("deferred"))).toHaveLength(1);
  expect(race.liveValue().value).toEqual({ icon: null, name: "Local" });
  expect(await race.durable()).toEqual(race.liveValue());
  expect(await race.voids()).toEqual([]);
  // The server's acceptance of the rename was not saved with a failed page.
  expect(await race.pending()).toHaveLength(1);

  // The next pass's copy holds the rename, so its judge voids the forgery.
  const synced = await race.sync();
  expect(synced && !("missing" in synced)).toBe(true);
  expect(await race.voids()).toMatchObject([
    { stage: "loro_import", updateId: race.forgedId },
  ]);
  expect(race.liveValue().value).toEqual({ icon: null, name: "Local" });
  expect(await race.durable()).toEqual(race.liveValue());
  expect(await race.pending()).toEqual([]);
});

test("a rename written while a pass saves a page forged on the writer peer takes a fresh peer, and both land", async () => {
  const race = await createForgedWriterPeerSync();
  let renaming: Promise<string> | undefined;
  // The pass imported the page into its copy before this save began.
  const persistence: ContainerContentsPersistence = {
    ...sqlContainerContentsPersistence,
    async commitMetadataMutation(...save) {
      if (!renaming) {
        await new Promise<void>((written) => {
          renaming = race.rename("Local", written);
        });
      }
      return sqlContainerContentsPersistence.commitMetadataMutation(...save);
    },
  };

  const synced = await race.sync(persistence);
  if (!renaming) throw new Error("Expected the rename to race the save");
  const renamePeer = await renaming;

  expect(synced && !("missing" in synced)).toBe(true);
  expect(renamePeer).not.toBe(race.writerPeer);
  expect(race.logs.filter((line) => line.includes("deferred"))).toEqual([]);
  expect(race.liveValue().value).toEqual({ icon: "forged", name: "Local" });
  expect(await race.durable()).toEqual(race.liveValue());
  expect(await race.voids()).toEqual([]);
  expect(await race.pending()).toHaveLength(1);
});
