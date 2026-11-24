import { expect } from "bun:test";
import {
  createReadOnlyDocument,
  satisfiesVersionVector,
} from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { DOCUMENTS_APP_KIND } from "../../../src/data/documents/documentConstants";
import type { SyncRemoteDocumentResult } from "../../../src/data/documents/shared/sync/documentSyncTypes";
import type { LoroLifetimes } from "../../../src/data/documents/shared/sync/loroLifetime";
import type { LoroWindowKind } from "../../../src/data/documents/shared/sync/loroWindowMachine";
import { createDocumentStore } from "../../../src/stores/documents/documentStore";
import {
  defaultDocumentsPersistence,
  RemoteDocumentService,
} from "../../../src/workflows/documents";
import { resolveDocumentCreateAuthor } from "../../../src/workflows/documents/author";
import { createDocumentProjectionUserKeyResolver } from "../../../src/workflows/documents/projectionKeys";
import { createDocumentSyncLoroWindow } from "../../../src/workflows/documents/sync/loroPassWindow";
import { claimDocumentSyncOrphanWindows } from "../../../src/workflows/documents/sync/loroWindows";
import { judgeUnrecordedDocumentSyncImports } from "../../../src/workflows/documents/sync/unrecordedImports";
import { createDocumentWriterPublicKeyResolver } from "../../../src/workflows/documents/writerKeys";
import {
  createResponseFromRequest,
  type DocumentCreateFixture,
} from "../data/documentFixtures";
import { device } from "../workflows/loroWindowBench";
import { createMaterializedSyncFixture } from "../workflows/materializedSyncFixture";
import {
  createEchoDocumentSyncResponse,
  createOnlineDocumentsRuntime,
  createStoredDocumentWriterProjection,
} from "../workflows/onlineDocumentStoreFixtures";

/**
 * Two devices holding one document's accepted history, for tests of deaths
 * that a founding view or a rotation's rebuild of that history meets
 * (#3194).
 */

type Runtime = ReturnType<typeof createOnlineDocumentsRuntime>;
interface DeviceOwner {
  readonly localId: string;
  readonly runtime: Runtime;
}

/**
 * A server that commits every update a device sends and serves every
 * committed update on each pull, raw history included, so each pull serves
 * the founding update again. One that `stopsAtVersionVector`, as a real
 * server does, serves a sync pull only the updates past the version vector
 * it names, besides the device's own echoed writes; a raw pull names none
 * and is served all. Each device keeps its own database.
 */
export async function twoDeviceHarness(
  name: string,
  options: { readonly stopsAtVersionVector?: boolean } = {},
) {
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
      const echoed = new Set(echo.updates.map((update) => update.id));
      const known = request.localVersionVector;
      const served = committed.filter(
        (update) =>
          !options.stopsAtVersionVector ||
          known === null ||
          echoed.has(update.id) ||
          !satisfiesVersionVector(known, update.partialEndVersionVector),
      );
      return { ...echo, updates: served };
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
  } satisfies Pick<SyncRemoteDocumentResult, "decryptedUpdates" | "response">;
}

/**
 * A founding-view (`read`) or rotation read in `lifetimes` that pulls raw
 * history and reads `updateId` alone in its window, as a page isolating that
 * update does, then never settles it: the lifetime died there. It claims the
 * windows dead lifetimes left first, as each of those reads does. A
 * rotation weighs the update against what the device accepted, or against
 * `acceptedVersion`, as a span forged to claim held counters would have it.
 */
async function readAloneAndDie(
  owner: DeviceOwner,
  lifetimes: LoroLifetimes,
  updateId: string,
  reading: { readonly acceptedVersion?: string; readonly kind: LoroWindowKind },
): Promise<void> {
  const { kind } = reading;
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
          reads:
            kind === "rotation"
              ? // As a rotation does, against what the device accepted.
                {
                  acceptedVersion:
                    reading.acceptedVersion ?? record.snapshotEndVersion,
                  kind,
                }
              : { kind },
          result: onlyUpdate(result, updateId),
          scope,
        }),
      warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer(),
    });
  } finally {
    scratch.free();
  }
}

export const loroWindowRows = (runtime: Runtime) =>
  runtime.infra.execSql("SELECT lifetime_id FROM document_loro_windows");

/**
 * A document one device founded and edited, then opened on a second, each
 * holding both updates. Returns the founding update the server committed.
 */
export async function openSyncedDevices(
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
 * `deaths` lifetimes of `owner` die reading `updateId` alone in `kind`
 * windows, and the next one's claim records the last of their deaths.
 */
export async function countDeaths(
  owner: DeviceOwner,
  documentId: string,
  updateId: string,
  deaths: number,
  options: {
    readonly acceptedVersion?: string;
    readonly kind?: LoroWindowKind;
    readonly logError?: (message: string | Error, cause?: unknown) => void;
  } = {},
): Promise<void> {
  const lifetimes = device();
  for (let index = 1; index <= deaths; index += 1) {
    const dying = lifetimes.lifetime(`counted-${index}`);
    await readAloneAndDie(owner, dying, updateId, {
      ...(options.acceptedVersion
        ? { acceptedVersion: options.acceptedVersion }
        : {}),
      kind: options.kind ?? "read",
    });
    lifetimes.kill(dying.id);
  }
  await claimDocumentSyncOrphanWindows({
    documentId,
    execSql: owner.runtime.infra.execSql,
    lifetimes: lifetimes.lifetime("claimer"),
    ...(options.logError ? { logError: options.logError } : {}),
    scope: { appKind: DOCUMENTS_APP_KIND, localId: owner.localId },
  });
}

/** The `loro_runtime` attempts this device counted toward `id`. */
export const runtimeAttempts = (
  owner: { readonly runtime: Runtime },
  id: string,
) =>
  owner.runtime.infra.execSql(
    "SELECT attempts FROM document_void_updates WHERE update_id = ?",
    [id],
  );
