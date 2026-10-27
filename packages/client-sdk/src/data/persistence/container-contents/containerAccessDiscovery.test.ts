import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDocumentDiscoveryEvidenceStore } from "../documents/documentDiscoveryEvidencePersistence";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";
import {
  containerContentsSyncLane,
  containerParentSyncLane,
  sqlContainerSyncWatermarkPersistence as watermarks,
} from "./containerSyncWatermarkPersistence";

for (const [from, to, commit] of [
  ["read", "write", true],
  ["write", "read", true],
  ["read", "read", true],
  ["read", undefined, true],
  ["write", undefined, true],
  ["read", "write", false],
] as const) {
  test(`container discovery follows ${from} -> ${to}, committed=${commit}`, async () => {
    const { execSql, close } = await createTestExecSql(
      "container-access-discovery",
    );
    try {
      await sqlContainerContentsPersistence.ensureSchema(execSql);
      const container = {
        effectiveAccessLevel: from,
        icon: null,
        id: "shared",
        metadataDocumentId: "metadata",
        name: "Shared",
        organizationId: "organization",
        parentId: null,
      };
      const record = {
        accessEpoch: 1,
        documentId: "metadata",
        id: "shared",
        metadataUpdates: "",
        snapshotEndVersion: "",
      };
      await sqlContainerContentsPersistence.saveContainer(
        execSql,
        container,
        record,
      );
      const current =
        await sqlContainerContentsPersistence.loadContainerMetadataState(
          execSql,
          container.id,
        );
      if (!current?.record) throw new Error("Expected held metadata");
      const lane = containerContentsSyncLane(container.id);
      const unrelated = containerContentsSyncLane("unrelated");
      const parent = containerParentSyncLane(container.id);
      const cursor = { id: "document", updatedAt: "2026-01-01T00:00:00.000Z" };
      for (const selected of [lane, unrelated, parent]) {
        await watermarks.recordLaneFetch(execSql, selected, {
          checked: true,
          watermark: cursor,
        });
      }
      const evidence = createDocumentDiscoveryEvidenceStore(execSql);
      const generation = await evidence.begin();
      const candidate = {
        accessEpoch: 1,
        containerId: container.id,
        createdAt: cursor.updatedAt,
        documentId: "document",
        effectiveAccessLevel: from,
        linkedContainerIds: [container.id],
        listedContainerIds: [container.id],
      };
      await evidence.stage(
        [
          candidate,
          {
            ...candidate,
            containerId: "unrelated",
            listedContainerIds: ["unrelated"],
          },
        ],
        generation,
      );
      const { effectiveAccessLevel: _previousLevel, ...withoutAccess } =
        current.container;
      const result =
        await sqlContainerContentsPersistence.commitMetadataMutation(execSql, {
          acceptedPendingUpdateIds: [],
          container: {
            ...withoutAccess,
            ...(to === undefined ? {} : { effectiveAccessLevel: to }),
          },
          expectedContainer: current.container,
          expectedRecord: current.record,
          record: current.record,
          settleAcceptedPendingOnConflict: false,
          stillCurrent: () => commit,
        });
      expect(result.committed).toBe(commit);
      const reset = commit && from !== (to ?? "read");
      expect(await watermarks.loadWatermark(execSql, lane)).toEqual(
        reset ? null : cursor,
      );
      const [check] = await watermarks.loadCheckRecords(execSql, [lane]);
      expect(check === null).toBe(reset);
      expect(await watermarks.loadWatermark(execSql, unrelated)).toEqual(
        cursor,
      );
      expect(await watermarks.loadWatermark(execSql, parent)).toEqual(cursor);
      expect(await evidence.isCurrent(generation)).toBe(!reset);
      expect(await evidence.hasPending([container.id])).toBe(!reset);
      expect(await evidence.hasPending(["unrelated"])).toBe(true);
      // A response started before the access change cannot restore its hints.
      expect(await evidence.stage([candidate], generation)).toBe(!reset);
      expect(await evidence.isCurrent(await evidence.begin())).toBe(true);
    } finally {
      close();
    }
  });
}
