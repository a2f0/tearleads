import { expect, test } from "bun:test";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { createContainerManifestFixture } from "@tearleads/crypto/test-fixtures";
import { loadCitedDocumentContainerPaths } from "./storedDocumentContainerPaths";
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
    lineageByHash: new Map(),
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
      lineageByHash: new Map(),
      path: [cycle, child],
      loadManifest: async (hash) =>
        hash === floor.manifestHash ? floor : cycle,
    }),
  ).rejects.toThrow("lineage is cyclic");
});

test("document history shares lineage work across changing heads and pins", async () => {
  const first = await createContainerManifestFixture({
    containerId: "ancestor",
    directGrants: [],
  });
  const history = [first];
  for (let epoch = 2; epoch <= 1_024; epoch += 1) {
    const previous = history.at(-1);
    if (!previous) throw new Error("Missing ancestor");
    history.push({
      ...first,
      manifestHash: `ancestor-${epoch}`,
      state: {
        ...first.state,
        epoch,
        previousManifestHash: previous.manifestHash,
      },
    });
  }
  const child = await createContainerManifestFixture({
    containerId: "child",
    directGrants: [],
    parentContainerId: first.state.containerId,
    parentManifestHash: first.manifestHash,
  });
  const byHash = new Map(history.map((head) => [head.manifestHash, head]));
  let loads = 0;
  const shared = {
    lineageByHash: new Map(),
    loadManifest: async (hash: string) => {
      loads += 1;
      const head = byHash.get(hash);
      if (!head) throw new Error("Missing cited manifest");
      return head;
    },
  };
  for (let index = 0; index < 256; index += 1) {
    const floor = history[index];
    const head = history[768 + index];
    if (!floor || !head) throw new Error("Missing history entry");
    const currentChild = {
      ...child,
      manifestHash: `child-${index}`,
      state: { ...child.state, parentManifestHash: floor.manifestHash },
    };
    byHash.set(currentChild.manifestHash, currentChild);
    const paths = await loadCitedDocumentContainerPaths({
      ...shared,
      dependencyManifestHashes: [head.manifestHash, currentChild.manifestHash],
    });
    expect(paths.at(-1)?.map((entry) => entry.manifestHash)).toEqual([
      head.manifestHash,
      currentChild.manifestHash,
    ]);
  }
  // Both heads and pins change: a cache of only identical queries is inadequate.
  expect(loads).toBeLessThan(2_048);
});

test("a recent creation pin does not load the parent's older history", async () => {
  const first = await createContainerManifestFixture({
    containerId: "ancestor",
    directGrants: [],
  });
  const history = [first];
  for (let epoch = 2; epoch <= 4_098; epoch += 1) {
    const previous = history.at(-1);
    if (!previous) throw new Error("Missing ancestor");
    history.push({
      ...first,
      manifestHash: epoch.toString(16).padStart(64, "0"),
      state: {
        ...first.state,
        epoch,
        previousManifestHash: previous.manifestHash,
      },
    });
  }
  const floor = history.at(-2);
  const head = history.at(-1);
  if (!floor || !head) throw new Error("Missing recent history");
  const child = await createContainerManifestFixture({
    containerId: "child",
    directGrants: [],
    parentContainerId: first.state.containerId,
    parentManifestHash: floor.manifestHash,
  });
  const byHash = new Map(
    [...history, child].map((entry) => [entry.manifestHash, entry]),
  );
  let loads = 0;
  const shared = {
    lineageByHash: new Map(),
    loadManifest: async (hash: string) => {
      loads += 1;
      const entry = byHash.get(hash);
      if (!entry) throw new Error("Missing manifest");
      return entry;
    },
  };
  const loadPath = (leaf: VerifiedContainerAccessManifest) =>
    loadCitedDocumentContainerPaths({
      ...shared,
      dependencyManifestHashes: [head.manifestHash, leaf.manifestHash],
    });
  const paths = await loadPath(child);
  expect(paths.at(-1)?.map((entry) => entry.manifestHash)).toEqual([
    head.manifestHash,
    child.manifestHash,
  ]);
  expect(loads).toBe(3);
  const olderChild = await createContainerManifestFixture({
    containerId: "older-child",
    directGrants: [],
    parentContainerId: first.state.containerId,
    parentManifestHash: first.manifestHash,
  });
  byHash.set(olderChild.manifestHash, olderChild);
  expect((await loadPath(olderChild)).at(-1)).toHaveLength(2);
  expect(shared.lineageByHash.size).toBe(4_098);
  const previousLoads = loads;
  expect((await loadPath(child)).at(-1)).toHaveLength(2);
  expect(loads - previousLoads).toBe(3);
});
