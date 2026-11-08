import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "./documentsPersistence";
import type { StoredDocumentRecord } from "./types";

const base = {
  accessEpoch: 1,
  containerId: "container",
  documentId: "document",
  id: "local-document",
  snapshotEndVersion: "base-version",
  text: "base",
};

/**
 * What a concurrent writer changes on the durable record after a sync pass
 * captured it, and whether acknowledged updates may still settle. Access
 * state is rewritten by discovery and membership refreshes without touching
 * the document the server stored the updates in; the remote target, key
 * epoch, key material, and placement are not.
 */
const cases: ReadonlyArray<{
  readonly change: Partial<StoredDocumentRecord>;
  readonly name: string;
  readonly settles: boolean;
}> = [
  {
    change: { accessStateHash: "refreshed", effectiveAccessLevel: "write" },
    name: "access state",
    settles: true,
  },
  { change: { accessEpoch: 2 }, name: "access epoch", settles: false },
  {
    change: { contentKeyBundle: "rotated-bundle" },
    name: "content key bundle",
    settles: false,
  },
  { change: { containerId: "moved" }, name: "placement", settles: false },
];

for (const { change, name, settles } of cases) {
  test(`acknowledged updates ${settles ? "settle" : "stay queued"} after a concurrent ${name} change`, async () => {
    const { close, execSql } = await createTestExecSql(`settle-${name}`);
    try {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      await sqlDocumentsPersistence.saveDocument(execSql, {
        ...base,
        accessStateHash: null,
        effectiveAccessLevel: "admin",
      });
      for (const suffix of ["first", "second"]) {
        await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
          localId: base.id,
          partialEndVersionVector: `${suffix}-end`,
          partialStartVersionVector: `${suffix}-start`,
          updateData: btoa(`${suffix}-update`),
        });
      }
      const queued = await sqlDocumentsPersistence.listPendingUpdates(
        execSql,
        base.id,
      );
      const [first, second] = queued;
      if (!first || !second) throw new Error("Expected two queued updates");
      const expectedRecord = await sqlDocumentsPersistence.loadDocument(
        execSql,
        base.id,
      );
      if (!expectedRecord) throw new Error("Expected the stored document");
      await sqlDocumentsPersistence.saveDocument(execSql, {
        ...expectedRecord,
        ...change,
      });

      // The response's own write loses its compare-and-set, settling on
      // conflict; then the standalone settlement a superseded response uses.
      const committed = await sqlDocumentsPersistence.commitDocumentMutation(
        execSql,
        {
          acceptedPendingUpdateIds: [first.id],
          document: { ...expectedRecord, text: "response" },
          expectedRecord,
          settleAcceptedPendingOnConflict: true,
        },
        async () => undefined,
      );
      expect(committed).toMatchObject({ committed: false });
      await sqlDocumentsPersistence.settleAcceptedPendingUpdates(execSql, {
        expectedRecord,
        pendingUpdateIds: [second.id],
      });

      const remaining = (
        await sqlDocumentsPersistence.listPendingUpdates(execSql, base.id)
      ).map(({ id }) => id);
      expect(remaining).toEqual(settles ? [] : [first.id, second.id]);
    } finally {
      close();
    }
  });
}
