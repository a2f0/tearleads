import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createMaterializedSyncFixture } from "../../../../test/helpers/documentFixtures";
import { createProbeRuntime } from "../../../../test/helpers/remoteSyncWait";
import { purgeLocalContainerDocument } from "../../../workflows/container-contents/documentPurge";
import {
  type DocumentRecord,
  defaultDocumentsPersistence,
} from "../../../workflows/documents";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { createDocumentStoreState } from "./state";
import { captureDocumentStoreSyncGeneration } from "./syncGeneration";
import { ensureRemoteDocument } from "./syncShared";

test.each(["unchanged", "replaced"] as const)(
  "a queued remote create checks a purged local row (replacement generation: %s)",
  async (generationChange) => {
    const replaceGeneration = generationChange === "replaced";
    const fixture = await createMaterializedSyncFixture();
    const { close, execSql } = await createTestExecSql(
      "remote-create-after-purge",
    );
    try {
      await defaultDocumentsPersistence.ensureSchema(execSql);
      const document = await createDocument("purged-queued-create");
      const replacement = await createDocument("replacement-queued-create");
      const record: DocumentRecord = {
        id: "purged-local-document",
        accessEpoch: 1,
        containerId: fixture.projection.containerId,
        documentId: null,
        snapshotEndVersion: encodeVersionVector(document),
        text: "",
      };
      await defaultDocumentsPersistence.saveDocument(execSql, record);
      let submissions = 0;
      let projectionReads = 0;
      const baseRuntime = createProbeRuntime({
        execSql,
        fixture,
        syncDocument: async () => null,
      });
      const apiClient = createMockApiClient({
        createDocument: async () => {
          submissions += 1;
          return null;
        },
        getContainerWriterProjection: async () => {
          projectionReads += 1;
          return fixture.projection;
        },
      });
      const runtime = { ...baseRuntime, apiClient };
      const state = createDocumentStoreState(
        record.id,
        runtime,
        defaultDocumentsPersistence,
        noopDocumentStorePersistenceEffects,
        null,
      );
      state.doc = document;
      state.record = record;
      state.initialized = true;
      expect(
        await purgeLocalContainerDocument({
          noteId: record.id,
          runtime,
          persistence: { ...defaultDocumentsPersistence },
        }),
      ).not.toBeNull();

      if (replaceGeneration) {
        state.persistence = {
          ...defaultDocumentsPersistence,
          loadDocument: async (...args) => {
            const result = await defaultDocumentsPersistence.loadDocument(
              ...args,
            );
            state.doc = replacement;
            return result;
          },
        };
      }
      const generation = captureDocumentStoreSyncGeneration(state, document);
      if (!generation) throw new Error("Expected sync generation");
      const result = await ensureRemoteDocument(
        state,
        document,
        record,
        { publicKey: fixture.publicKey, secretKey: fixture.secretKey },
        generation,
      );
      expect(submissions).toBe(0);
      expect(projectionReads).toBe(0);
      if (replaceGeneration) {
        expect(state.doc).toBe(replacement);
        expect(state.record).toBe(record);
      } else {
        expect(result).toBeNull();
        expect(state.doc).toBeNull();
        expect(state.record).toBeNull();
        expect(state.initialized).toBe(true);
      }
      expect(
        await defaultDocumentsPersistence.loadDocument(execSql, record.id),
      ).toBeNull();
    } finally {
      close();
    }
  },
);
