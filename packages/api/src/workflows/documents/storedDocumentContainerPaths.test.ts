import { expect, test } from "bun:test";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { createContainerManifestFixture } from "@tearleads/crypto/test-fixtures";
import { loadCitedDocumentContainerPaths } from "./storedDocumentContainerPaths";

async function scenario() {
  const root1 = await createContainerManifestFixture({
    directGrants: [],
    containerId: "cited-root",
    epoch: 1,
  });
  const root2 = await createContainerManifestFixture({
    directGrants: [],
    containerId: "cited-root",
    epoch: 2,
  });
  const child = await createContainerManifestFixture({
    directGrants: [],
    containerId: "cited-child",
    parentContainerId: root1.state.containerId,
    parentManifestHash: root1.manifestHash,
  });
  const byHash = new Map(
    [root1, root2, child].map((head) => [head.manifestHash, head]),
  );
  const loadManifest = async (hash: string) => {
    const head = byHash.get(hash);
    if (!head) throw new Error("stored citation is unavailable");
    return head;
  };
  return { root1, root2, child, loadManifest };
}

test("stored paths follow cited ancestors and ignore creation pins and input order", async () => {
  const { root2, child, loadManifest } = await scenario();
  const paths = await loadCitedDocumentContainerPaths({
    dependencyManifestHashes: [child.manifestHash, root2.manifestHash],
    loadManifest,
  });
  expect(paths[0]?.map((head) => head.manifestHash)).toEqual([
    root2.manifestHash,
    child.manifestHash,
  ]);
});

test("stored cited paths reject ancestors from another organization", async () => {
  const { root1, child } = await scenario();
  const foreignRoot = await createContainerManifestFixture({
    containerId: root1.state.containerId,
    organizationId: "foreign-organization",
    directGrants: [],
  });
  await expect(
    loadCitedDocumentContainerPaths({
      dependencyManifestHashes: [foreignRoot.manifestHash, child.manifestHash],
      loadManifest: async (hash) =>
        hash === foreignRoot.manifestHash ? foreignRoot : child,
    }),
  ).rejects.toThrow("crosses organizations");
});

test("stored paths reject omitted ancestors even when the loader has the pinned head", async () => {
  const { child, loadManifest } = await scenario();
  await expect(
    loadCitedDocumentContainerPaths({
      dependencyManifestHashes: [child.manifestHash],
      loadManifest,
    }),
  ).rejects.toThrow("does not cite ancestor");
});

test("stored paths reject two cited heads of one container", async () => {
  const { root1, root2, loadManifest } = await scenario();
  await expect(
    loadCitedDocumentContainerPaths({
      dependencyManifestHashes: [root1.manifestHash, root2.manifestHash],
      loadManifest,
    }),
  ).rejects.toThrow("two heads of one container");
});

test("stored paths reject unavailable and mismatched citation lookups", async () => {
  const { root1, loadManifest } = await scenario();
  await expect(
    loadCitedDocumentContainerPaths({
      dependencyManifestHashes: ["withheld"],
      loadManifest,
    }),
  ).rejects.toThrow("unavailable");
  await expect(
    loadCitedDocumentContainerPaths({
      dependencyManifestHashes: ["substituted"],
      loadManifest: async () => root1,
    }),
  ).rejects.toThrow("does not match its citation");
});

test("stored path reconstruction bounds cycles and depth", async () => {
  const { root1 } = await scenario();
  // Structural graph tests start after signature verification, the loader's
  // explicit precondition. No fabricated graph is used as crypto evidence.
  const heads = Array.from(
    { length: 101 },
    (_, i): VerifiedContainerAccessManifest => ({
      ...root1,
      manifestHash: `hash-${i}`,
      state: {
        ...root1.state,
        containerId: `container-${i}`,
        parentContainerId: i === 0 ? null : `container-${i - 1}`,
      },
    }),
  );
  const run = () =>
    loadCitedDocumentContainerPaths({
      dependencyManifestHashes: heads.map((head) => head.manifestHash),
      loadManifest: async (hash) => {
        const head = heads.find((candidate) => candidate.manifestHash === hash);
        if (!head) throw new Error("Missing structural test head");
        return head;
      },
    });
  await expect(run()).rejects.toThrow("maximum depth");
  heads.splice(100);
  expect((await run()).at(-1)).toHaveLength(100);
  const root = heads[0];
  if (!root) throw new Error("Expected structural test root");
  heads[0] = {
    ...root,
    state: { ...root.state, parentContainerId: "container-99" },
  };
  await expect(run()).rejects.toThrow("cycle");
});
