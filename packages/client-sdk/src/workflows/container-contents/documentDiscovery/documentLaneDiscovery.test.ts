import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  ContainerSyncWatermarkRepository,
  containerContentsSyncLane,
} from "../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { DocumentDiscoveryEvidenceRepository } from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import {
  documentLaneDiscoveryState,
  listOwedDocumentLaneContainerIds,
} from "./documentLaneDiscovery";

const AT = "2026-11-25T00:00:00.000Z";

test("a lane is settled only when it was settled and holds no candidate", () => {
  expect(
    documentLaneDiscoveryState({ pendingCandidates: false, settled: true }),
  ).toEqual({ status: "settled" });
  expect(
    documentLaneDiscoveryState({ pendingCandidates: false, settled: false }),
  ).toEqual({ reason: "unsettled", status: "owed" });
  expect(
    documentLaneDiscoveryState({ pendingCandidates: true, settled: true }),
  ).toEqual({ reason: "pending-candidates", status: "owed" });
  expect(
    documentLaneDiscoveryState({ pendingCandidates: true, settled: false }),
  ).toEqual({ reason: "pending-candidates", status: "owed" });
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

    expect(
      await listOwedDocumentLaneContainerIds(execSql, [
        "never-listed",
        "empty",
        "settled",
        "cursor-only",
        "restaged",
      ]),
    ).toEqual(["never-listed", "cursor-only", "restaged"]);
    expect(await listOwedDocumentLaneContainerIds(execSql, [])).toEqual([]);
  } finally {
    close();
  }
});
