import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import {
  type PruneBaseline,
  type PruneCandidate,
  planDominatedUpdatePrune,
} from "./documentUpdatePrune";

// Build three real version vectors: `early` ⊂ `late` (same peer, monotonic) and
// `concurrent` from a different peer that `late` does NOT dominate.
async function buildVersions() {
  const docA = await createDocument("prune-seed-a");
  const textA = docA.getText("text");
  textA.insert(0, "a");
  docA.commit();
  const early = encodeVersionVector(docA);
  textA.insert(1, "bcd");
  docA.commit();
  const late = encodeVersionVector(docA);

  const docB = await createDocument("prune-seed-b");
  docB.getText("text").insert(0, "z");
  docB.commit();
  const concurrent = encodeVersionVector(docB);

  return { early, late, concurrent };
}

test("prunes pre-rotation updates the baseline dominates, keeps the rest", async () => {
  const { early, late, concurrent } = await buildVersions();
  const baselines: PruneBaseline[] = [
    { documentId: "doc-1", sourceVersionVector: late, baselineEpoch: 2 },
  ];
  const candidates: PruneCandidate[] = [
    {
      id: "u-dominated",
      documentId: "doc-1",
      contentKeyEpoch: 1,
      byteLength: 100,
      partialEndVersionVector: early,
    },
    {
      // Concurrent pre-rotation write the baseline never saw: must NOT be pruned.
      id: "u-concurrent",
      documentId: "doc-1",
      contentKeyEpoch: 1,
      byteLength: 200,
      partialEndVersionVector: concurrent,
    },
    {
      // Current-epoch update: not pre-rotation, so never pruned.
      id: "u-current",
      documentId: "doc-1",
      contentKeyEpoch: 2,
      byteLength: 400,
      partialEndVersionVector: early,
    },
  ];

  const plan = planDominatedUpdatePrune({ baselines, candidates, limit: 100 });

  expect(plan.updateIds).toEqual(["u-dominated"]);
  expect(plan.reclaimedBytes).toBe(100);
  expect(plan.documentIds).toEqual(["doc-1"]);
});

test("respects the prune limit", async () => {
  const { early, late } = await buildVersions();
  const baselines: PruneBaseline[] = [
    { documentId: "doc-1", sourceVersionVector: late, baselineEpoch: 2 },
  ];
  const candidates: PruneCandidate[] = Array.from(
    { length: 5 },
    (_, index) => ({
      id: `u-${index}`,
      documentId: "doc-1",
      contentKeyEpoch: 1,
      byteLength: 10,
      partialEndVersionVector: early,
    }),
  );

  const plan = planDominatedUpdatePrune({ baselines, candidates, limit: 3 });

  expect(plan.updateIds).toHaveLength(3);
  expect(plan.reclaimedBytes).toBe(30);
});

test("ignores updates for documents without a baseline", async () => {
  const { early, late } = await buildVersions();
  const baselines: PruneBaseline[] = [
    { documentId: "doc-1", sourceVersionVector: late, baselineEpoch: 2 },
  ];
  const candidates: PruneCandidate[] = [
    {
      id: "other-doc",
      documentId: "doc-2",
      contentKeyEpoch: 1,
      byteLength: 50,
      partialEndVersionVector: early,
    },
  ];

  const plan = planDominatedUpdatePrune({ baselines, candidates, limit: 100 });

  expect(plan.updateIds).toEqual([]);
  expect(plan.reclaimedBytes).toBe(0);
});
