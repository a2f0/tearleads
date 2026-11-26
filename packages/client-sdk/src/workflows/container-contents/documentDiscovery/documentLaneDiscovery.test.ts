import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  ContainerSyncWatermarkRepository,
  containerContentsSyncLane,
} from "../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { DocumentLaneRevalidationRepository } from "../../../data/persistence/container-contents/documentLaneRevalidations";
import { DocumentDiscoveryEvidenceRepository } from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import {
  documentLaneDiscoveryState,
  listOwedDocumentLaneContainerIds,
} from "./documentLaneDiscovery";

const AT = "2026-11-25T00:00:00.000Z";

test("a lane is settled only when it was settled, holds no candidate and owes no request", () => {
  const state = (
    pendingCandidates: boolean,
    settled: boolean,
    requested = false,
  ) => documentLaneDiscoveryState({ pendingCandidates, requested, settled });
  expect(state(false, true)).toEqual({ status: "settled" });
  expect(state(false, false)).toEqual({ reason: "unsettled", status: "owed" });
  expect(state(true, true)).toEqual({
    reason: "pending-candidates",
    status: "owed",
  });
  expect(state(true, false)).toEqual({
    reason: "pending-candidates",
    status: "owed",
  });
  // A tree listing was served the container's row after the lane settled.
  expect(state(false, true, true)).toEqual({
    reason: "requested",
    status: "owed",
  });
  expect(state(false, false, true)).toEqual({
    reason: "unsettled",
    status: "owed",
  });
});

test("owed lanes come from durable lane rows and staged candidates", async () => {
  const { close, execSql } = await createTestExecSql("document-lane-owed");
  try {
    const lanes = new ContainerSyncWatermarkRepository(execSql);
    const evidence = new DocumentDiscoveryEvidenceRepository(execSql);
    // Settled by a complete, empty listing: no cursor, only the mark.
    await lanes.recordLaneFetch(containerContentsSyncLane("empty"), {
      checked: true,
      watermark: null,
    });
    await lanes.recordLaneFetch(containerContentsSyncLane("settled"), {
      checked: true,
      watermark: { id: "settled-cursor", updatedAt: AT },
    });
    // A listing that left candidates pending advanced only the cursor.
    await lanes.recordLaneFetch(containerContentsSyncLane("cursor-only"), {
      checked: false,
      watermark: { id: "cursor-only-cursor", updatedAt: AT },
    });
    // Settled earlier, then a later listing staged a candidate.
    await lanes.recordLaneFetch(containerContentsSyncLane("restaged"), {
      checked: true,
      watermark: { id: "restaged-cursor", updatedAt: AT },
    });
    expect(
      await evidence.stage(
        [
          {
            accessEpoch: 1,
            containerId: "restaged",
            createdAt: AT,
            documentId: "doc",
            linkedContainerIds: ["restaged"],
            listedContainerIds: ["restaged"],
          },
        ],
        await evidence.begin(),
      ),
    ).toBe(true);

    // Settled earlier, then a tree listing was served the container's row.
    await lanes.recordLaneFetch(containerContentsSyncLane("moved"), {
      checked: true,
      watermark: { id: "moved-cursor", updatedAt: AT },
    });
    const requests = new DocumentLaneRevalidationRepository(execSql);
    await requests.request(["moved", "not-held"]);

    const known = [
      "never-listed",
      "empty",
      "settled",
      "cursor-only",
      "restaged",
      "moved",
    ];
    expect(await listOwedDocumentLaneContainerIds(execSql, known)).toEqual([
      "never-listed",
      "cursor-only",
      "restaged",
      "moved",
    ]);
    expect(await listOwedDocumentLaneContainerIds(execSql, [])).toEqual([]);

    // The listing that read the request before it began settles the lane.
    const [request] = await requests.find(["moved"]);
    if (!request) throw new Error("Expected the request");
    await requests.settle(request);
    expect(await listOwedDocumentLaneContainerIds(execSql, known)).toEqual([
      "never-listed",
      "cursor-only",
      "restaged",
    ]);
  } finally {
    close();
  }
});
