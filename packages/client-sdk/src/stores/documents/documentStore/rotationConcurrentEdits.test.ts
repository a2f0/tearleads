import { expect, test } from "bun:test";
import { createDocument, getTextValue, importSnapshot } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { settleWithin } from "../../../../test/helpers/remoteSyncWait";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import {
  createRemoteHistoryFixture,
  noopDocumentStorePersistenceEffects,
} from "./documentStore.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";
import { setDocumentText } from "./mutations";
import { listPendingUpdates } from "./persistence";
import { assertDocumentStoreCanRotateContentKey } from "./rotation";
import {
  createRotationRecoveryRuntime,
  persistFullHistoryDocument,
} from "./rotationRecoveryHelpers.test";
import { createDocumentStoreState } from "./state";

for (const editCount of [1, 3]) {
  test(`rotation retries ${editCount} concurrent autosaves without holding local persistence`, async () => {
    const { close, execSql } = await createTestExecSql(
      `rotation-concurrent-${editCount}`,
    );
    const gates = Array.from({ length: editCount }, () => ({
      started: Promise.withResolvers<void>(),
      release: Promise.withResolvers<void>(),
    }));
    try {
      const fixture = await createRemoteHistoryFixture();
      const localId = "rotation-concurrent-edit-local";
      await sqlDocumentsPersistence.ensureSchema(execSql);
      await persistFullHistoryDocument({
        doc: fixture.remoteDocument,
        documentId: fixture.writerProjection.documentId,
        execSql,
        localId,
      });
      const committed: DocumentSyncResponse["updates"] = [];
      let rawPulls = 0;
      const runtime = createRotationRecoveryRuntime({
        execSql,
        fixture,
        requireRawHistory: false,
        responseForRequest: async (request, response) => {
          if (request.historyMode === "raw") {
            const gate = gates[rawPulls++];
            gate?.started.resolve();
            await gate?.release.promise;
          }
          const outgoingIds = new Set(
            request.outgoingUpdates.map((update) => update.id),
          );
          committed.push(
            ...response.updates.filter((update) => outgoingIds.has(update.id)),
          );
          return {
            ...response,
            updates: [...fixture.response.updates, ...committed],
          };
        },
      });
      const state = createDocumentStoreState(
        localId,
        runtime,
        sqlDocumentsPersistence,
        noopDocumentStorePersistenceEffects,
        fixture.writerProjection.documentId,
      );
      await ensureDocumentStoreReady(state, () => undefined);
      const recovery = assertDocumentStoreCanRotateContentKey(state).then(
        (snapshot) => snapshot,
        (error: unknown) => error,
      );
      for (const [index, gate] of gates.entries()) {
        await settleWithin(gate.started.promise, "rotation raw pull");
        await settleWithin(
          setDocumentText(state, () => undefined, `Autosave ${index}`),
          "local autosave during raw pull",
        );
        expect(
          (await sqlDocumentsPersistence.loadDocument(execSql, localId))?.text,
        ).toBe(`Autosave ${index}`);
        gate.release.resolve();
      }
      let result = await recovery;
      expect(rawPulls).toBe(3);
      if (editCount === 3) {
        expect(result).toBeInstanceOf(Error);
        expect(String(result)).toContain("Document changed");
        expect((await listPendingUpdates(state)).length).toBeGreaterThan(0);
        expect(state.snapshot.text).toBe("Autosave 2");
        result = await assertDocumentStoreCanRotateContentKey(state);
      }
      expect(result).toBeInstanceOf(Uint8Array);
      if (!(result instanceof Uint8Array))
        throw new Error("Rotation did not recover", { cause: result });
      const reader = await createDocument(
        `rotation-concurrent-reader-${editCount}`,
      );
      try {
        importSnapshot(reader, result);
        expect(getTextValue(reader)).toBe(`Autosave ${editCount - 1}`);
        expect(state.snapshot.text).toBe(getTextValue(reader));
        expect(await listPendingUpdates(state)).toHaveLength(0);
      } finally {
        reader.free();
      }
    } finally {
      for (const gate of gates) gate.release.resolve();
      close();
    }
  });
}

test("rotation retries an autosave that races the pending-update read after raw history", async () => {
  const { close, execSql } = await createTestExecSql(
    "rotation-pending-read-edit",
  );
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let recovery: Promise<unknown> | undefined;
  let armed = false;
  let held = false;
  let rawPulls = 0;
  const persistence = {
    ...sqlDocumentsPersistence,
    listPendingUpdates: async (
      ...args: Parameters<typeof sqlDocumentsPersistence.listPendingUpdates>
    ) => {
      const rows = await sqlDocumentsPersistence.listPendingUpdates(...args);
      if (armed && !held) {
        held = true;
        started.resolve();
        await release.promise;
      }
      return rows;
    },
  };
  try {
    const fixture = await createRemoteHistoryFixture();
    const localId = "rotation-pending-read-local";
    await sqlDocumentsPersistence.ensureSchema(execSql);
    await persistFullHistoryDocument({
      doc: fixture.remoteDocument,
      documentId: fixture.writerProjection.documentId,
      execSql,
      localId,
    });
    const committed: DocumentSyncResponse["updates"] = [];
    const runtime = createRotationRecoveryRuntime({
      execSql,
      fixture,
      requireRawHistory: false,
      responseForRequest: async (request, response) => {
        if (request.historyMode === "raw") {
          rawPulls += 1;
          armed = true;
        }
        const outgoingIds = new Set(
          request.outgoingUpdates.map((update) => update.id),
        );
        committed.push(
          ...response.updates.filter((update) => outgoingIds.has(update.id)),
        );
        return {
          ...response,
          updates: [...fixture.response.updates, ...committed],
        };
      },
    });
    const state = createDocumentStoreState(
      localId,
      runtime,
      persistence,
      noopDocumentStorePersistenceEffects,
      fixture.writerProjection.documentId,
    );
    await ensureDocumentStoreReady(state, () => undefined);
    recovery = assertDocumentStoreCanRotateContentKey(state).catch(
      (error: unknown) => error,
    );
    await settleWithin(
      started.promise,
      "pending-update read after raw history",
    );
    await settleWithin(
      setDocumentText(state, () => undefined, "Autosave during pending read"),
      "autosave beside held SQL read",
    );
    expect(
      (await sqlDocumentsPersistence.loadDocument(execSql, localId))?.text,
    ).toBe("Autosave during pending read");
    release.resolve();
    const result = await recovery;
    expect(result).toBeInstanceOf(Uint8Array);
    expect(rawPulls).toBe(3);
    expect(state.snapshot.text).toBe("Autosave during pending read");
    expect(await listPendingUpdates(state)).toHaveLength(0);
  } finally {
    release.resolve();
    await recovery;
    close();
  }
});
