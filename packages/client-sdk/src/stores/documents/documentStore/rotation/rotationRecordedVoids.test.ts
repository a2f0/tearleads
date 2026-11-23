import { expect, setSystemTime, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createDocument,
  encodeVersionVector,
  exportAllUpdates,
  exportFullHistorySnapshot,
  exportUpdatesSince,
  getTextValue,
  getUpdateVersionVectors,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncUpdateResponse } from "@tearleads/validators/response";
import {
  createPendingUpdateRecord,
  createSyncResponse,
} from "../../../../../test/helpers/data/documentFixtures";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "../../../../../test/helpers/workflows/rotationRecoveryRuntime";
import { deriveDocumentContentKeyCommitments } from "../../../../data/documents/shared/sync/contentKeyCommitment";
import { documentVerdictJudge } from "../../../../data/documents/shared/sync/documentUpdateVerdict";
import { MAX_LORO_RUNTIME_ATTEMPTS } from "../../../../data/documents/shared/sync/loroRuntimeFailureLedger";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import type { PendingUpdateRecord } from "../../../../workflows/documents";
import { buildMaterializedDocumentSyncPlan } from "../../../../workflows/documents/syncPlan/syncPlanMaterial";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { createDocumentStoreState } from "../state";
import { assertDocumentStoreCanRotateContentKey } from "./index";

type Fixture = Awaited<ReturnType<typeof createRemoteHistoryFixture>>;
type LiveDocument = Awaited<ReturnType<typeof createDocument>>;

async function soloEdit(name: string) {
  const document = await createDocument(name);
  document.getText("text").update(name);
  document.commit();
  const data = exportAllUpdates(document);
  document.free();
  return { data, ...getUpdateVersionVectors(data) };
}

async function signedUpdates(
  fixture: Fixture,
  pendingUpdates: PendingUpdateRecord[],
): Promise<DocumentSyncUpdateResponse[]> {
  const { plan } = await buildMaterializedDocumentSyncPlan({
    author: fixture.author,
    localVersionVector: null,
    pendingUpdates,
    targetSecretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: fixture.writerProjection,
  });
  return (await createSyncResponse(plan, { acceptedOutgoingUpdateIds: [] }))
    .updates;
}

/** Signed by the document's writer, declaring another peer's span. */
async function falseSpanRecord(id: string, name: string) {
  const carried = await soloEdit(`${name}-carried`);
  const declared = await soloEdit(`${name}-declared`);
  return createPendingUpdateRecord({
    id,
    partialEndVersionVector: declared.partialEndVersionVector,
    partialStartVersionVector: declared.partialStartVersionVector,
    updateData: bytesToBase64(carried.data),
  });
}

async function rotationState(input: {
  execSql: ExecSql;
  extraUpdates: readonly DocumentSyncUpdateResponse[];
  fixture: Fixture;
  liveDocument: LiveDocument;
  localId: string;
  /** Served alone on a second raw page. */
  secondPage?: readonly DocumentSyncUpdateResponse[] | undefined;
}) {
  const { secondPage } = input;
  const { documentId } = input.fixture.writerProjection;
  await persistFullHistoryDocument({
    doc: input.liveDocument,
    documentId,
    execSql: input.execSql,
    localId: input.localId,
  });
  const state = createDocumentStoreState(
    input.localId,
    createRotationRecoveryRuntime({
      execSql: input.execSql,
      fixture: input.fixture,
      responseForRequest: (request, response) => {
        if (secondPage === undefined) {
          return {
            ...response,
            updates: [...response.updates, ...input.extraUpdates],
          };
        }
        return request.pullCursor === undefined
          ? {
              ...response,
              pullPage: {
                hasMore: true,
                nextCursor: "rotation-page-2",
                throughUpdateId: null,
              },
              updates: [...response.updates, ...input.extraUpdates],
            }
          : { ...response, updates: [...secondPage] };
      },
    }),
    sqlDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    documentId,
  );
  expect(await ensureDocumentStoreReady(state, () => undefined)).toBe(true);
  return state;
}

const voidRows = (execSql: ExecSql, localId: string) =>
  execSql(
    `SELECT update_id, stage FROM document_void_updates
     WHERE local_id = ? ORDER BY update_id`,
    [localId],
  );

async function withDatabase(
  name: string,
  run: (execSql: ExecSql) => Promise<void>,
): Promise<void> {
  const { close, execSql } = await createTestExecSql(name);
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await run(execSql);
  } finally {
    close();
  }
}

// An update that failed the Loro runtime in enough process lifetimes is void
// for good. Rotation used to import it again, and fail on it, or, where it
// now imports, rebuild a history the live document never held.
test("rotation keeps an update this device voided out of the rebuild", async () => {
  await withDatabase("rotation-recorded-runtime-void", async (execSql) => {
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-recorded-runtime-void-local";
    const voidedId = "550e8400-e29b-41d4-a716-446655440451";
    const edit = await soloEdit("rotation-recorded-runtime-void");
    const extraUpdates = await signedUpdates(fixture, [
      createPendingUpdateRecord({
        id: voidedId,
        partialEndVersionVector: edit.partialEndVersionVector,
        partialStartVersionVector: edit.partialStartVersionVector,
        updateData: bytesToBase64(edit.data),
      }),
    ]);
    const state = await rotationState({
      execSql,
      extraUpdates,
      fixture,
      liveDocument: fixture.remoteDocument,
      localId,
    });
    const { contentKeyEpoch } = fixture.writerProjection.contentKeyBundle;
    const { documentId } = fixture.writerProjection;
    const fingerprints = await deriveDocumentContentKeyCommitments({
      contentKeysByEpoch: new Map([[contentKeyEpoch, fixture.contentKey]]),
      documentId,
    });
    await execSql(
      `INSERT INTO document_void_updates (app_kind, local_id, document_id,
         update_id, stage, message, attempts, judge, content_key_epoch,
         key_fingerprint, voided_at)
       VALUES ('documents', ?, ?, ?, 'loro_runtime', 'trapped', ?, ?, ?, ?,
         '2026-11-23T00:00:00.000Z')`,
      [
        localId,
        documentId,
        voidedId,
        MAX_LORO_RUNTIME_ATTEMPTS,
        documentVerdictJudge(),
        contentKeyEpoch,
        fingerprints.get(contentKeyEpoch) ?? null,
      ],
    );

    await assertDocumentStoreCanRotateContentKey(state);
    expect(state.doc && getTextValue(state.doc)).toBe("survives key rotation");
    expect(await voidRows(execSql, localId)).toEqual([
      { stage: "loro_runtime", update_id: voidedId },
    ]);
  });
});

/**
 * When the writer commits: its served history, the checkpoint's own edit,
 * then the child. Loro merges a peer's commits within its change-merge
 * interval into one change stamped with its first commit's time, in whole
 * seconds. These give one change, one change spanning a second boundary, a
 * merged checkpoint edit with a separate child, and three changes.
 */
const writerClocks = [
  {
    checkpoint: "00:00:00.500",
    child: "00:00:00.500",
    name: "one instant",
    served: "00:00:00.500",
  },
  {
    checkpoint: "00:00:01.400",
    child: "00:00:01.400",
    name: "merged across a second",
    served: "00:00:00.400",
  },
  {
    checkpoint: "00:00:00.900",
    child: "00:00:01.700",
    name: "child apart",
    served: "00:00:00.100",
  },
  {
    checkpoint: "00:00:05.000",
    child: "00:00:10.000",
    name: "far apart",
    served: "00:00:00.500",
  },
] as const;

/** Runs `run` with the clock at `time` on a fixed day. */
async function withClock<T>(time: string, run: () => T): Promise<Awaited<T>> {
  setSystemTime(new Date(`2026-11-23T${time}Z`));
  try {
    return await run();
  } finally {
    setSystemTime();
  }
}

/**
 * A writer's checkpoint carrying one edit, then an ordinary child of it. The
 * writer continues the history it served, as an honest writer does, so every
 * holder of an operation holds it with the same commit time.
 */
async function checkpointAndChild(
  fixture: Fixture,
  clock: (typeof writerClocks)[number],
) {
  const writer = fixture.remoteDocument;
  const checkpointEnd = await withClock(clock.checkpoint, () => {
    writer.getText("text").update("then more");
    writer.commit();
    return encodeVersionVector(writer);
  });
  const snapshot = exportFullHistorySnapshot(writer);
  const vectors = getUpdateVersionVectors(snapshot);
  await withClock(clock.child, () => {
    writer.getText("text").update("a child of the checkpoint");
    writer.commit();
  });
  const child = exportUpdatesSince(writer, checkpointEnd);
  const [checkpointUpdate] = await signedUpdates(fixture, [
    createPendingUpdateRecord({
      id: "550e8400-e29b-41d4-a716-446655440452",
      sourceVersionVector: vectors.partialEndVersionVector,
      updateData: bytesToBase64(snapshot),
      ...vectors,
    }),
  ]);
  const [childUpdate] = await signedUpdates(fixture, [
    createPendingUpdateRecord({
      id: "550e8400-e29b-41d4-a716-446655440453",
      updateData: bytesToBase64(child),
      ...getUpdateVersionVectors(child),
    }),
  ]);
  if (!checkpointUpdate || !childUpdate) throw new Error("Expected updates");
  // Every holder of these operations, a reader that synced them included.
  return { checkpointUpdate, childUpdate, synced: writer };
}

// A sync pass accepts a writer's checkpoint and the ordinary update that
// depends on it, so the live document holds both. The rebuild must hold them
// too: otherwise the proof fails on every attempt, and no rotation or unlink
// of the document completes, or a baseline drops the writer's edits.
for (const split of [false, true]) {
  for (const [index, clock] of writerClocks.entries()) {
    const pages = split ? "pages split" : "one page";
    test(`rotation keeps a synced checkpoint's operations (${pages}, ${clock.name})`, async () => {
      const name = `rotation-synced-checkpoint-${split}-${index}`;
      await withDatabase(name, async (execSql) => {
        const localId = `${name}-local`;
        const fixture = await withClock(
          clock.served,
          createRemoteHistoryFixture,
        );
        const { checkpointUpdate, childUpdate, synced } =
          await checkpointAndChild(fixture, clock);
        const state = await rotationState({
          execSql,
          extraUpdates: split
            ? [checkpointUpdate]
            : [checkpointUpdate, childUpdate],
          fixture,
          liveDocument: synced,
          localId,
          secondPage: split ? [childUpdate] : undefined,
        });

        const snapshot = await assertDocumentStoreCanRotateContentKey(state);
        const baseline = await createDocument(
          "rotation-synced-checkpoint-read",
        );
        importSnapshot(baseline, snapshot);
        expect(getTextValue(baseline)).toBe("a child of the checkpoint");
        expect(encodeVersionVector(baseline)).toBe(encodeVersionVector(synced));
        expect(await voidRows(execSql, localId)).toEqual([]);
        baseline.free();
        synced.free();
      });
    });
  }
}

// A checkpoint can only add operations: the rebuild still imports every
// ordinary update, including one a later checkpoint served on the page does
// not carry.
test("rotation imports ordinary updates a later checkpoint lacks", async () => {
  await withDatabase("rotation-behind-checkpoint", async (execSql) => {
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-behind-checkpoint-local";
    const vectors = getUpdateVersionVectors(fixture.behindSnapshot);
    const extraUpdates = await signedUpdates(fixture, [
      createPendingUpdateRecord({
        id: "550e8400-e29b-41d4-a716-446655440455",
        sourceVersionVector: vectors.partialEndVersionVector,
        updateData: bytesToBase64(fixture.behindSnapshot),
        ...vectors,
      }),
    ]);
    const state = await rotationState({
      execSql,
      extraUpdates,
      fixture,
      liveDocument: fixture.remoteDocument,
      localId,
    });

    const snapshot = await assertDocumentStoreCanRotateContentKey(state);
    const baseline = await createDocument("rotation-behind-checkpoint-read");
    importSnapshot(baseline, snapshot);
    expect(getTextValue(baseline)).toBe("survives key rotation");
    expect(await voidRows(execSql, localId)).toEqual([]);
    baseline.free();
  });
});

// A void is recorded only once the rebuilt history proves equal to the live
// one; a rebuild that fails the proof vouches for nothing it left out.
test("a rotation that fails its proof records no void", async () => {
  await withDatabase("rotation-unproven-void", async (execSql) => {
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-unproven-void-local";
    const live = await createDocument("rotation-unproven-live");
    importSnapshot(live, exportFullHistorySnapshot(fixture.remoteDocument));
    live.getText("text").update("survives key rotation, unverified");
    live.commit();
    const extraUpdates = await signedUpdates(fixture, [
      await falseSpanRecord(
        "550e8400-e29b-41d4-a716-446655440454",
        "rotation-unproven-void",
      ),
    ]);
    const state = await rotationState({
      execSql,
      extraUpdates,
      fixture,
      liveDocument: live,
      localId,
    });

    await expect(assertDocumentStoreCanRotateContentKey(state)).rejects.toThrow(
      "unverified local history",
    );
    expect(await voidRows(execSql, localId)).toEqual([]);
    live.free();
  });
});

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let start = 0; start < length; start += 65_536) {
    crypto.getRandomValues(bytes.subarray(start, start + 65_536));
  }
  return bytes;
}

/** An honest update whose parents no served update carries. */
async function orphanRecord(id: string, name: string) {
  const parent = await createDocument(`${name}-parent`);
  parent.getText("text").update(`${name} parent`);
  parent.commit();
  const child = await createDocument(name);
  importUpdates(child, [exportAllUpdates(parent)]);
  parent.free();
  const parentEnd = encodeVersionVector(child);
  child.getText("text").update(`${name} child`);
  child.commit();
  const data = exportUpdatesSince(child, parentEnd);
  child.free();
  return createPendingUpdateRecord({
    id,
    updateData: bytesToBase64(data),
    ...getUpdateVersionVectors(data),
  });
}

// A sync pass defers the rest of a page once rebuilding its scratch history
// after each void passes a budget, and pulls it again. A rotation that
// deferred failed and met the same page on every retry, so enough voids
// behind a large update stopped it for good.
test("rotation settles a page whose voids pass the sync rebuild budget", async () => {
  await withDatabase("rotation-void-rebuild-budget", async (execSql) => {
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-void-rebuild-budget-local";
    const padding = await createDocument("rotation-budget-padding");
    padding.getMap("padding").set("bytes", randomBytes(2 * 1024 * 1024));
    padding.commit();
    const large = exportAllUpdates(padding);
    padding.free();
    const live = await createDocument("rotation-budget-live");
    importSnapshot(live, exportFullHistorySnapshot(fixture.remoteDocument));
    importUpdates(live, [large]);
    const records = [
      createPendingUpdateRecord({
        id: "550e8400-e29b-41d4-a716-446655440460",
        updateData: bytesToBase64(large),
        ...getUpdateVersionVectors(large),
      }),
    ];
    // Each void costs a rebuild of more than 2 MiB; 20 pass the 32 MiB budget.
    for (let index = 10; index < 30; index += 1) {
      const id = `550e8400-e29b-41d4-a716-4466554404${index}`;
      records.push(await orphanRecord(id, `rotation-budget-${index}`));
    }
    const extraUpdates: DocumentSyncUpdateResponse[] = [];
    for (const record of records) {
      extraUpdates.push(...(await signedUpdates(fixture, [record])));
    }
    const state = await rotationState({
      execSql,
      extraUpdates,
      fixture,
      liveDocument: live,
      localId,
    });

    await assertDocumentStoreCanRotateContentKey(state);
    expect(state.doc && getTextValue(state.doc)).toBe("survives key rotation");
    // Import voids stay out of the rebuild unrecorded.
    expect(await voidRows(execSql, localId)).toEqual([]);
    live.free();
  });
}, 60_000);
