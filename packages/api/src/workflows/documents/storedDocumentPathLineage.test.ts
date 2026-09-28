import { expect, test } from "bun:test";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { createContainerManifestFixture } from "@tearleads/crypto/test-fixtures";
import { assertStoredDocumentPathLineage } from "./storedDocumentPathLineage";

test("ancestor lineage can reach a creation pin beyond the old history bound", async () => {
  const first = await createContainerManifestFixture({
    containerId: "ancestor",
    directGrants: [],
  });
  const history = new Map<string, VerifiedContainerAccessManifest>([
    [first.manifestHash, first],
  ]);
  let head = first;
  // The lineage loader consumes already-verified objects; these structural
  // fixtures isolate traversal from the signature-verifier regression.
  for (let epoch = 2; epoch <= 4_098; epoch += 1) {
    head = {
      ...first,
      manifestHash: `ancestor-${epoch}`,
      state: { ...first.state, epoch, previousManifestHash: head.manifestHash },
    };
    history.set(head.manifestHash, head);
  }
  const child = await createContainerManifestFixture({
    containerId: "child",
    directGrants: [],
    parentContainerId: first.state.containerId,
    parentManifestHash: first.manifestHash,
  });
  const loaded = new Set<string>();
  await assertStoredDocumentPathLineage({
    path: [head, child],
    loadManifest: async (hash) => {
      loaded.add(hash);
      const manifest = history.get(hash);
      if (!manifest) throw new Error("Missing ancestor");
      return manifest;
    },
  });
  expect(loaded.size).toBe(history.size - 1);
});

test("a cyclic retained ancestor chain is refused", async () => {
  const floor = await createContainerManifestFixture({
    containerId: "ancestor",
    directGrants: [],
  });
  const cycle = {
    ...floor,
    manifestHash: "cycle",
    state: { ...floor.state, epoch: 3, previousManifestHash: "cycle" },
  };
  const child = await createContainerManifestFixture({
    containerId: "child",
    directGrants: [],
    parentContainerId: floor.state.containerId,
    parentManifestHash: floor.manifestHash,
  });
  await expect(
    assertStoredDocumentPathLineage({
      path: [cycle, child],
      loadManifest: async (hash) =>
        hash === floor.manifestHash ? floor : cycle,
    }),
  ).rejects.toThrow("lineage is cyclic");
});
