import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { countingExecSql } from "../../../../test/helpers/statementCounting";
import { sqlDocumentContainerProjectionPersistence } from "../container-contents/documentContainerProjectionPersistence";
import { createDocumentDiscoveryEvidenceStore } from "./documentDiscoveryEvidencePersistence";
import {
  applyContainerDocumentTombstones,
  sqlDocumentsPersistence,
} from "./documentsPersistence";

const COUNT = 32;
const documentIds = Array.from({ length: COUNT }, (_, i) => `remote-${i}`);

async function bookkeepingFixture(name: string) {
  const sqlite = await createTestExecSql(name);
  const counted = countingExecSql(sqlite.execSql);
  await sqlDocumentsPersistence.ensureSchema(counted.execSql);
  // Warm the link and evidence table ensures so they are not counted.
  await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
    counted.execSql,
    [],
  );
  const evidence = createDocumentDiscoveryEvidenceStore(counted.execSql);
  await evidence.isCurrent(0);
  return { ...sqlite, counted, evidence };
}

const candidate = (documentId: string, index: number) => ({
  accessEpoch: 1,
  containerId: "container-a",
  createdAt: `2026-10-30T00:00:${String(index).padStart(2, "0")}.000Z`,
  documentId,
  linkedContainerIds: ["container-a"],
  listedContainerIds: ["container-a"],
});

test("discovery bookkeeping runs in a fixed number of statements", async () => {
  const f = await bookkeepingFixture("discovery-bookkeeping-budget");
  try {
    const links = await f.counted.count(() =>
      sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
        f.counted.execSql,
        documentIds.map((documentId) => ({
          containerIds: ["container-a", "container-b"],
          documentId,
        })),
      ),
    );
    const generation = await f.evidence.begin();
    const candidates = documentIds.map(candidate);
    const stage = await f.counted.count(() =>
      f.evidence.stage(candidates, generation),
    );
    const acknowledge = await f.counted.count(() =>
      f.evidence.acknowledge(candidates, generation),
    );
    // Links: BEGIN, the intent and epoch reads, two 50-pair hold deletes for
    // 64 placements, the link delete and insert, COMMIT (was 5 + N = 37).
    // Stage and acknowledge: the generation check, BEGIN, one multi-row
    // statement, COMMIT (each was 3 + N = 35).
    expect({ acknowledge, links, stage }).toEqual({
      acknowledge: 4,
      links: 7,
      stage: 4,
    });
  } finally {
    f.close();
  }
});

test("tombstone apply runs in a fixed number of statements", async () => {
  const f = await bookkeepingFixture("tombstone-apply-budget");
  try {
    const tombstoned = documentIds.slice(0, 8);
    for (const documentId of tombstoned) {
      await sqlDocumentsPersistence.saveDocument(f.execSql, {
        accessEpoch: 1,
        containerId: "container-b",
        documentId,
        id: `local-${documentId}`,
        snapshotEndVersion: "",
        text: "",
      });
    }
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
      f.counted.execSql,
      tombstoned.map((documentId) => ({
        containerIds: ["container-a", "container-b"],
        documentId,
      })),
    );
    const count = await f.counted.count(() =>
      applyContainerDocumentTombstones(
        f.counted.execSql,
        tombstoned.map((documentId) => ({
          accessEpoch: 1,
          containerId: "container-b",
          documentId,
          linkedContainerIds: ["container-a"],
          updatedAt: "2026-10-30T01:00:00.000Z",
        })),
      ),
    );
    // BEGIN, the intent and epoch reads, the placement, unlinked-row, and hold
    // deletes, the local id, link, and projection reads, one projection update
    // per repointed row, the summary read, COMMIT (was 5 + 7N = 61 at N = 8).
    expect(count).toBe(11 + tombstoned.length);
  } finally {
    f.close();
  }
});

test("set staging stores what one candidate at a time does", async () => {
  const batched = await bookkeepingFixture("discovery-stage-set");
  const single = await bookkeepingFixture("discovery-stage-single");
  try {
    const first = candidate("remote-0", 0);
    const candidates = [
      first,
      { ...first, accessEpoch: 2 },
      { ...candidate("remote-1", 1), listedContainerIds: ["c-1", "c-2"] },
      first,
    ];
    const batchedGeneration = await batched.evidence.begin();
    const singleGeneration = await single.evidence.begin();
    // A deferred row keeps its backoff only while its stored input is unchanged.
    await batched.evidence.stage([first], batchedGeneration);
    await single.evidence.stage([first], singleGeneration);
    await batched.evidence.defer(first, batchedGeneration);
    await single.evidence.defer(first, singleGeneration);
    await batched.evidence.stage(candidates, batchedGeneration, [
      { containerId: "c-2", documentId: "remote-1" },
    ]);
    for (const input of candidates) {
      await single.evidence.stage([input], singleGeneration);
    }
    await single.evidence.stage([], singleGeneration, [
      { containerId: "c-2", documentId: "remote-1" },
    ]);
    const dump = (execSql: typeof batched.execSql) =>
      execSql(
        "SELECT * FROM pending_document_discoveries ORDER BY container_id, document_id",
      );
    const stored = await dump(batched.execSql);
    expect(stored).toEqual(await dump(single.execSql));
    expect(stored).toHaveLength(2);
    await batched.evidence.acknowledge(candidates, batchedGeneration);
    for (const input of candidates) {
      await single.evidence.acknowledge([input], singleGeneration);
    }
    expect(await dump(batched.execSql)).toEqual(await dump(single.execSql));
  } finally {
    batched.close();
    single.close();
  }
});
