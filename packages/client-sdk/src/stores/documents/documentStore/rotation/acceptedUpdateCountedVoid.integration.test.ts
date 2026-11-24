import { expect, test } from "bun:test";
import { createReadOnlyDocument } from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import {
  createResponseFromRequest,
  type DocumentCreateFixture,
} from "../../../../../test/helpers/data/documentFixtures";
import { installFakeWebLocks } from "../../../../../test/helpers/data/fakeWebLocks";
import { device } from "../../../../../test/helpers/workflows/loroWindowBench";
import { createMaterializedSyncFixture } from "../../../../../test/helpers/workflows/materializedSyncFixture";
import {
  createEchoDocumentSyncResponse,
  createOnlineDocumentsRuntime,
  createStoredDocumentWriterProjection,
} from "../../../../../test/helpers/workflows/onlineDocumentStoreFixtures";
import { DOCUMENTS_APP_KIND } from "../../../../data/documents/documentConstants";
import type { SyncRemoteDocumentResult } from "../../../../data/documents/shared/sync/documentSyncTypes";
import type { LoroLifetimes } from "../../../../data/documents/shared/sync/loroLifetime";
import {
  defaultDocumentsPersistence,
  RemoteDocumentService,
  readDocumentFoundingUpdate,
} from "../../../../workflows/documents";
import { resolveDocumentCreateAuthor } from "../../../../workflows/documents/author";
import { createDocumentProjectionUserKeyResolver } from "../../../../workflows/documents/projectionKeys";
import { createDocumentSyncLoroWindow } from "../../../../workflows/documents/sync/loroPassWindow";
import { claimDocumentSyncOrphanWindows } from "../../../../workflows/documents/sync/loroWindows";
import { readFinalDocumentVoidUpdateIds } from "../../../../workflows/documents/sync/processedCursor";
import { judgeUnrecordedDocumentSyncImports } from "../../../../workflows/documents/sync/unrecordedImports";
import { createDocumentWriterPublicKeyResolver } from "../../../../workflows/documents/writerKeys";
import { createDocumentStore } from "../index";

type Runtime = ReturnType<typeof createOnlineDocumentsRuntime>;

/**
 * A server that commits every update a device sends and serves every
 * committed update on each pull, raw history included, so each pull serves
 * the founding update again. Each device keeps its own database.
 */
async function twoDeviceHarness(name: string) {
  const fixture = await createMaterializedSyncFixture();
  const committed: DocumentSyncResponse["updates"] = [];
  const databases: { close: () => void }[] = [];
  let requests = 0;
  let storedDocument: DocumentCreateFixture | null = null;
  const apiClient = createMockApiClient({
    async createDocument(
      request: Parameters<typeof createResponseFromRequest>[0],
    ) {
      storedDocument = await createResponseFromRequest(request);
      return storedDocument;
    },
    getContainerWriterProjection: async () => fixture.projection,
    getDocumentWriterProjection: async () =>
      storedDocument
        ? createStoredDocumentWriterProjection(fixture, storedDocument)
        : null,
    listDocumentAttachments: async () => [],
    async syncDocument(_documentId: string, request: DocumentSyncRequest) {
      if (!storedDocument) return null;
      requests += 1;
      const echo = createEchoDocumentSyncResponse({
        commitLsn: `0/${requests.toString(16).toUpperCase()}0`,
        request,
        storedDocument,
      });
      committed.push(...echo.updates);
      return { ...echo, updates: [...committed] };
    },
  });
  const openDevice = async (localId: string) => {
    const database = await createTestExecSql(`${name}-${localId}`);
    databases.push(database);
    const runtime = createOnlineDocumentsRuntime({
      apiClient,
      execSql: database.execSql,
      fixture,
    });
    return { localId, runtime };
  };
  const documentId = () => {
    if (!storedDocument) throw new Error("Expected a remote document");
    return storedDocument.id;
  };
  const close = () => {
    for (const database of databases) database.close();
  };
  return { close, committed, documentId, openDevice };
}

function onlyUpdate(
  result: Parameters<typeof judgeUnrecordedDocumentSyncImports>[0]["result"],
  updateId: string,
) {
  return {
    ...result,
    decryptedUpdates: result.decryptedUpdates.filter(
      (update) => update.id === updateId,
    ),
    response: {
      ...result.response,
      updates: result.response.updates.filter(
        (update) => update.id === updateId,
      ),
    },
  } satisfies Pick<
    SyncRemoteDocumentResult,
    "contentKeyFingerprintsByEpoch" | "decryptedUpdates" | "response"
  >;
}

/**
 * A rotation or founding-view read in `lifetimes` that pulls raw history and
 * reads `updateId` alone in its window, as a page isolating that update
 * does, then never settles it: the lifetime died there. It claims the
 * windows dead lifetimes left first, as each of those reads does.
 */
async function readAloneAndDie(
  owner: { readonly localId: string; readonly runtime: Runtime },
  lifetimes: LoroLifetimes,
  updateId: string,
): Promise<void> {
  const { localId, runtime } = owner;
  const { execSql } = runtime.infra;
  const record = await defaultDocumentsPersistence.loadDocument(
    execSql,
    localId,
  );
  const author = resolveDocumentCreateAuthor(runtime);
  const keys = runtime.crypto.encapsulationKeyPair;
  if (!record?.documentId || !author || !keys)
    throw new Error("Expected a synced document");
  const { documentId } = record;
  const scope = { appKind: DOCUMENTS_APP_KIND, localId };
  await claimDocumentSyncOrphanWindows({
    documentId,
    execSql,
    lifetimes,
    scope,
  });
  const scratch = createReadOnlyDocument();
  try {
    await new RemoteDocumentService({
      api: runtime.apiClient,
      encapsulationSecretKey: keys.secretKey,
      execSql,
      isRemoteSyncBlocked: runtime.util.isRemoteSyncBlocked,
    }).syncRemoteDocument({
      author,
      documentId,
      historyMode: "raw",
      localVersionVector: null,
      minLsn: record.lastCommitLsn ?? undefined,
      pendingUpdates: [],
      persistedState: record,
      resolveProjectionUserKey:
        createDocumentProjectionUserKeyResolver(runtime),
      resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
        logPrefix: "Documents",
        runtime,
        writerKeyLabel: "writer key",
      }),
      stillCurrent: () => true,
      validateIncomingUpdates: (result) =>
        judgeUnrecordedDocumentSyncImports({
          currentDocument: scratch,
          documentId,
          execSql,
          lifetimes,
          loroWindow: createDocumentSyncLoroWindow(),
          result: onlyUpdate(result, updateId),
          scope,
        }),
      warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer(),
    });
  } finally {
    scratch.free();
  }
}

const loroWindowRows = (runtime: Runtime) =>
  runtime.infra.execSql("SELECT lifetime_id FROM document_loro_windows");

/**
 * A document one device founded and edited, then opened on a second, each
 * holding both updates. Returns the founding update the server committed.
 */
async function openSyncedDevices(
  harness: Awaited<ReturnType<typeof twoDeviceHarness>>,
) {
  const first = await harness.openDevice("first");
  const store = createDocumentStore(
    first.localId,
    first.runtime,
    defaultDocumentsPersistence,
    null,
    "Founding text",
  );
  expect(await store.ensureInitialized()).toBe(true);
  expect(await store.requestRemoteSyncAndWait()).toBe(true);
  await store.setText("A later edit");
  expect(await store.requestRemoteSyncAndWait()).toBe(true);
  const [founding] = harness.committed;
  if (!founding) throw new Error("Expected the founding update");

  const second = await harness.openDevice("second");
  const peer = createDocumentStore(
    second.localId,
    second.runtime,
    defaultDocumentsPersistence,
    harness.documentId(),
  );
  expect(await peer.ensureInitialized()).toBe(true);
  expect(await peer.requestRemoteSyncAndWait()).toBe(true);
  expect(peer.getSnapshot().text).toBe("A later edit");
  return { first, founding, peer, second, store };
}

/**
 * `deaths` lifetimes of `owner` die reading `updateId` alone, and the next
 * one's claim records the last of their attempts.
 */
async function countDeaths(
  owner: { readonly localId: string; readonly runtime: Runtime },
  documentId: string,
  updateId: string,
  deaths: number,
): Promise<void> {
  const lifetimes = device();
  for (let index = 1; index <= deaths; index += 1) {
    const dying = lifetimes.lifetime(`counted-${index}`);
    await readAloneAndDie(owner, dying, updateId);
    lifetimes.kill(dying.id);
  }
  await claimDocumentSyncOrphanWindows({
    documentId,
    execSql: owner.runtime.infra.execSql,
    lifetimes: lifetimes.lifetime("claimer"),
    scope: { appKind: DOCUMENTS_APP_KIND, localId: owner.localId },
  });
}

// A rotation or founding view reads served history this device already
// accepted, so the deaths it counts can void an update the live document
// holds (#3194). The device then stops vouching for that update: its own
// rotation proof and founding view leave it out, while it still opens,
// edits, and syncs, and no other device waits on it.
test("an accepted update counted void leaves the device syncing and another rotating", async () => {
  const harness = await twoDeviceHarness("accepted-counted-void");
  const removeWebLocks = installFakeWebLocks();
  try {
    const { first, founding, peer, second, store } =
      await openSyncedDevices(harness);
    // Three lifetimes die reading the founding update alone; the fourth's
    // claim records the third attempt, which voids it for good.
    await countDeaths(first, harness.documentId(), founding.id, 3);
    const voids = () =>
      readFinalDocumentVoidUpdateIds(
        first.runtime.infra.execSql,
        harness.documentId(),
      );
    expect([...(await voids())]).toEqual([founding.id]);

    // This device no longer vouches for the update: its founding view and
    // rotation proof leave it out, and the proof fails without a write.
    const readFounding = (owner: typeof first) =>
      readDocumentFoundingUpdate({
        localId: owner.localId,
        runtime: owner.runtime,
        stillCurrent: () => true,
      });
    expect(await readFounding(first)).toBeNull();
    const committedBefore = harness.committed.length;
    await expect(store.assertCanRotateContentKey("prove")).rejects.toThrow(
      "unverified local history",
    );
    expect(harness.committed).toHaveLength(committedBefore);
    expect(await loroWindowRows(first.runtime)).toEqual([]);

    // Another device holds no such verdict, so it proves and reads alone.
    expect(await peer.assertCanRotateContentKey("prove")).toBeInstanceOf(
      Uint8Array,
    );
    expect((await readFounding(second))?.content.text).toBe("Founding text");

    // Both devices still edit and sync; each pull serves the void update
    // again, and this device keeps it void without importing it.
    await store.setText("Edited after the void");
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    expect(await peer.requestRemoteSyncAndWait()).toBe(true);
    expect(peer.getSnapshot().text).toBe("Edited after the void");
    await peer.setText("Edited on the other device");
    expect(await peer.requestRemoteSyncAndWait()).toBe(true);
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    expect(store.getSnapshot().text).toBe("Edited on the other device");
    expect([...(await voids())]).toEqual([founding.id]);

    // The document still opens from what this device persisted.
    const reopened = createDocumentStore(
      first.localId,
      first.runtime,
      defaultDocumentsPersistence,
      harness.documentId(),
    );
    expect(await reopened.ensureInitialized()).toBe(true);
    expect(reopened.getSnapshot().text).toBe("Edited on the other device");
  } finally {
    removeWebLocks();
    harness.close();
  }
}, 20_000);

const runtimeAttempts = (owner: { readonly runtime: Runtime }, id: string) =>
  owner.runtime.infra.execSql(
    "SELECT attempts FROM document_void_updates WHERE update_id = ?",
    [id],
  );

// A death counted toward an accepted update leaves it unsettled, not void.
// That holds nothing this device syncs: a pull that serves it again reads
// it and accepts it, dropping the attempt, and rotation proves as before.
test("one counted death on an accepted update holds nothing the device syncs", async () => {
  const harness = await twoDeviceHarness("accepted-counted-once");
  const removeWebLocks = installFakeWebLocks();
  try {
    const { first, founding, peer, store } = await openSyncedDevices(harness);
    await countDeaths(first, harness.documentId(), founding.id, 1);
    expect(await runtimeAttempts(first, founding.id)).toEqual([
      { attempts: 1 },
    ]);

    await peer.setText("Edited on the other device");
    expect(await peer.requestRemoteSyncAndWait()).toBe(true);
    expect(await store.requestRemoteSyncAndWait()).toBe(true);

    expect(store.getSnapshot().text).toBe("Edited on the other device");
    expect(await runtimeAttempts(first, founding.id)).toEqual([]);
    expect(await store.assertCanRotateContentKey("prove")).toBeInstanceOf(
      Uint8Array,
    );
  } finally {
    removeWebLocks();
    harness.close();
  }
}, 20_000);
