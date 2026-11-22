import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  decodeVersionVector,
  encodeVersionVector,
  exportUpdatesSince,
  getUpdateVersionVectors,
} from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import {
  createPendingUpdateRecord,
  createResponseFromRequest,
  type DocumentCreateFixture,
} from "../../../../../test/helpers/data/documentFixtures";
import { createMaterializedSyncFixture } from "../../../../../test/helpers/workflows/materializedSyncFixture";
import {
  createEchoDocumentSyncResponse,
  createOnlineDocumentsRuntime,
  createStoredDocumentWriterProjection,
} from "../../../../../test/helpers/workflows/onlineDocumentStoreFixtures";
import { defaultDocumentsPersistence } from "../../../../workflows/documents";
import { buildMaterializedDocumentSyncPlan } from "../../../../workflows/documents/syncPlan/syncPlanMaterial";
import { createDocumentStore } from "../index";

type ServedUpdate = DocumentSyncResponse["updates"][number];

const LIAR_ID = "550e8400-e29b-41d4-a716-446655440702";
const HONEST_ID = "550e8400-e29b-41d4-a716-446655440703";

/** Like the server's filter: a span the request's version leaves uncovered. */
function uncovered(update: ServedUpdate, localVersionVector: string | null) {
  const frontier = decodeVersionVector(localVersionVector);
  for (const [peer, end] of decodeVersionVector(
    update.partialEndVersionVector,
  ).toJSON()) {
    if ((frontier.get(peer) ?? 0) < end) return true;
  }
  return false;
}

/**
 * A documents server that commits in order, filters a pull by version and
 * processed cursor, and names its head as the pull's upper bound.
 */
async function createServerHarness(name: string) {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(name);
  const committed: ServedUpdate[] = [];
  const requests: DocumentSyncRequest[] = [];
  const reported: unknown[] = [];
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
    async syncDocumentResult(
      _documentId: string,
      request: DocumentSyncRequest,
    ) {
      if (!storedDocument) throw new Error("document not created");
      requests.push(request);
      const echo = createEchoDocumentSyncResponse({
        commitLsn: `0/${requests.length}0`,
        request,
        storedDocument,
      });
      committed.push(...echo.updates);
      const processed = committed.findIndex(
        (update) => update.id === request.processedThroughUpdateId,
      );
      const updates = committed
        .slice(processed + 1)
        .filter((update) => uncovered(update, request.localVersionVector));
      return {
        data: {
          ...echo,
          pullPage: {
            hasMore: false,
            nextCursor: null,
            throughUpdateId: committed.at(-1)?.id ?? null,
          },
          updates,
        },
        ok: true,
      };
    },
  });
  const online = createOnlineDocumentsRuntime({ apiClient, execSql, fixture });
  const runtime = {
    ...online,
    util: {
      ...online.util,
      logError: (_message: unknown, error: unknown) => {
        reported.push(error);
      },
    },
  };
  /** Commits updates another writer of this document signed. */
  async function commitFromAnotherWriter(
    pending: readonly ReturnType<typeof createPendingUpdateRecord>[],
  ) {
    if (!storedDocument) throw new Error("document not created");
    const materialized = await buildMaterializedDocumentSyncPlan({
      author: fixture.author,
      localVersionVector: null,
      pendingUpdates: [...pending],
      targetSecretKey: fixture.secretKey,
      trustedLocalProjection: true,
      writerProjection: createStoredDocumentWriterProjection(
        fixture,
        storedDocument,
      ),
    });
    committed.push(
      ...createEchoDocumentSyncResponse({
        commitLsn: "0/1",
        request: materialized.plan.request,
        storedDocument,
      }).updates,
    );
  }
  return {
    close,
    commitFromAnotherWriter,
    execSql,
    reported,
    requests,
    runtime,
  };
}

async function otherWriterEdits(name: string, count: number) {
  const document = await createDocument(name);
  const edits: { data: Uint8Array; end: string; start: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = encodeVersionVector(document);
    document.getText("text").insert(0, `${name}-${index} `);
    document.commit();
    const data = exportUpdatesSince(document, start);
    edits.push({ data, ...vectorsOf(data) });
  }
  document.free();
  return edits;
}

function vectorsOf(data: Uint8Array) {
  const vectors = getUpdateVersionVectors(data);
  return {
    end: vectors.partialEndVersionVector,
    start: vectors.partialStartVersionVector,
  };
}

async function voidRows(
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
) {
  return (await execSql(
    "SELECT update_id, stage FROM document_void_updates ORDER BY update_id",
  )) as { stage: string; update_id: string }[];
}

test("a false-span update is voided while the pass, later edits, and queued writes go on", async () => {
  const localId = "false-span-reader";
  const harness = await createServerHarness(localId);
  try {
    const store = createDocumentStore(
      localId,
      harness.runtime,
      defaultDocumentsPersistence,
      null,
      "",
      "note",
    );
    expect(await store.ensureInitialized()).toBe(true);
    await store.setText("mine");
    expect(await store.requestRemoteSyncAndWait()).toBe(true);

    const [carried, claimed] = await otherWriterEdits("liar", 2);
    const [honest] = await otherWriterEdits("honest", 1);
    if (!carried || !claimed || !honest) throw new Error("expected edits");
    await harness.commitFromAnotherWriter([
      // Carries the liar's first edit, declares both.
      createPendingUpdateRecord({
        id: LIAR_ID,
        partialEndVersionVector: claimed.end,
        partialStartVersionVector: carried.start,
        updateData: bytesToBase64(carried.data),
      }),
      createPendingUpdateRecord({
        id: HONEST_ID,
        partialEndVersionVector: honest.end,
        partialStartVersionVector: honest.start,
        updateData: bytesToBase64(honest.data),
      }),
    ]);

    // A queued edit rides the pass that meets the liar.
    await store.setText("mine, edited");
    expect(await store.requestRemoteSyncAndWait()).toBe(true);
    expect(store.getSnapshot().text).toContain("honest-0");
    expect(store.getSnapshot().text).not.toContain("liar-0");
    expect(store.getSnapshot().text).toContain("mine, edited");
    expect(
      await harness.execSql(
        "SELECT sync_failure_message FROM documents WHERE local_id = ?",
        [localId],
      ),
    ).toEqual([{ sync_failure_message: null }]);
    expect(await voidRows(harness.execSql)).toEqual([
      { stage: "loro_metadata", update_id: LIAR_ID },
    ]);
    expect(harness.reported).toHaveLength(1);

    // The next pull starts after everything this one judged.
    const throughUpdateId = harness.requests.at(-1)?.processedThroughUpdateId;
    await store.requestRemoteSyncAndWait();
    const cursor = harness.requests.at(-1)?.processedThroughUpdateId;
    expect(cursor).toBeDefined();
    expect(cursor).not.toBe(throughUpdateId);
    expect(harness.reported).toHaveLength(1);
    expect(await voidRows(harness.execSql)).toHaveLength(1);
  } finally {
    harness.close();
  }
});

test("a cursor recorded with a version the frontier no longer covers is not sent", async () => {
  const localId = "false-span-restored";
  const harness = await createServerHarness(localId);
  try {
    const store = createDocumentStore(
      localId,
      harness.runtime,
      defaultDocumentsPersistence,
      null,
      "",
      "note",
    );
    expect(await store.ensureInitialized()).toBe(true);
    await store.setText("restored");
    await store.requestRemoteSyncAndWait();
    await store.requestRemoteSyncAndWait();
    expect(harness.requests.at(-1)?.processedThroughUpdateId).toBeDefined();

    // As if restored to state older than the cursor's version.
    const [ahead] = await otherWriterEdits("ahead", 1);
    if (!ahead) throw new Error("expected an edit");
    await harness.execSql(
      "UPDATE document_sync_progress SET through_version = ? WHERE local_id = ?",
      [ahead.end, localId],
    );
    await store.requestRemoteSyncAndWait();
    expect(harness.requests.at(-1)?.processedThroughUpdateId).toBeUndefined();
  } finally {
    harness.close();
  }
});

test("a cursor judged by another decoder or rule set is not sent", async () => {
  const localId = "false-span-upgraded";
  const harness = await createServerHarness(localId);
  try {
    const store = createDocumentStore(
      localId,
      harness.runtime,
      defaultDocumentsPersistence,
      null,
      "",
      "note",
    );
    expect(await store.ensureInitialized()).toBe(true);
    await store.setText("upgraded");
    await store.requestRemoteSyncAndWait();
    await store.requestRemoteSyncAndWait();
    expect(harness.requests.at(-1)?.processedThroughUpdateId).toBeDefined();

    await harness.execSql(
      "UPDATE document_sync_progress SET judge = ? WHERE local_id = ?",
      ["void-rules-0:loro-crdt@0.0.0", localId],
    );
    await store.requestRemoteSyncAndWait();
    expect(harness.requests.at(-1)?.processedThroughUpdateId).toBeUndefined();
    // That pull judged everything again under the running judge.
    await store.requestRemoteSyncAndWait();
    expect(harness.requests.at(-1)?.processedThroughUpdateId).toBeDefined();
  } finally {
    harness.close();
  }
});
