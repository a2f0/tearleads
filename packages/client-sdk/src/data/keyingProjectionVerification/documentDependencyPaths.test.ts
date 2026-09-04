import { expect, test } from "bun:test";
import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { createScenario } from "../../../test/helpers/ancestorCitationScenario";
import { resolveEventContainerPaths } from "./documentDependencyPaths";

function index(manifests: readonly VerifiedContainerAccessManifest[]) {
  return new Map(
    manifests.map((manifest) => [manifest.manifestHash, [manifest]]),
  );
}

test("document paths use signed ancestors instead of creation-time pins", async () => {
  const { root1, root2, child1 } = await createScenario();
  expect(child1.state.parentManifestHash).toBe(root1.manifestHash);
  const resolved = resolveEventContainerPaths({
    containerPathByManifestHash: index([root1, root2, child1]),
    dependencyManifestHashes: [child1.manifestHash, root2.manifestHash],
    targetManifestHash: child1.manifestHash,
  });
  expect(
    resolved.targetContainerPath?.map((manifest) => manifest.manifestHash),
  ).toEqual([root2.manifestHash, child1.manifestHash]);
});

test("a served parent pin cannot fill an omitted document citation", async () => {
  const { root1, child1 } = await createScenario();
  expect(() =>
    resolveEventContainerPaths({
      containerPathByManifestHash: new Map([
        [child1.manifestHash, [root1, child1]],
      ]),
      dependencyManifestHashes: [child1.manifestHash],
      targetManifestHash: child1.manifestHash,
    }),
  ).toThrow("does not cite ancestor");
});

test("document citations reject two heads of one ancestor and duplicate hashes", async () => {
  const { root1, root2, child1 } = await createScenario();
  for (const other of [root1, root2]) {
    expect(() =>
      resolveEventContainerPaths({
        containerPathByManifestHash: index([root1, root2, child1]),
        dependencyManifestHashes: [
          root1.manifestHash,
          other.manifestHash,
          child1.manifestHash,
        ],
        targetManifestHash: child1.manifestHash,
      }),
    ).toThrow("two heads of one container");
  }
});

test("unavailable citations are rejected even when the target has a served path", async () => {
  const { root1, child1 } = await createScenario();
  expect(() =>
    resolveEventContainerPaths({
      containerPathByManifestHash: new Map([
        [child1.manifestHash, [root1, child1]],
      ]),
      dependencyManifestHashes: [
        root1.manifestHash,
        child1.manifestHash,
        "withheld",
      ],
      targetManifestHash: child1.manifestHash,
    }),
  ).toThrow("cites an unavailable container manifest");
});

test("an uncited target does not acquire a path from server metadata", async () => {
  const { root1, child1 } = await createScenario();
  const resolved = resolveEventContainerPaths({
    containerPathByManifestHash: new Map([
      [child1.manifestHash, [root1, child1]],
    ]),
    dependencyManifestHashes: [root1.manifestHash],
    targetManifestHash: child1.manifestHash,
  });
  expect(resolved.targetContainerPath).toBeUndefined();
});

test("citation reconstruction bounds depth and rejects cycles", async () => {
  const { root1 } = await createScenario();
  // Synthetic structural variants exercise only the resolver's graph bounds;
  // they are not offered as cryptographic verification evidence.
  const heads = Array.from({ length: 101 }, (_, index) => ({
    ...root1,
    manifestHash: `depth-${index}`,
    state: {
      ...root1.state,
      containerId: `container-${index}`,
      parentContainerId: index === 0 ? null : `container-${index - 1}`,
    },
  }));
  const resolve = (values: typeof heads) =>
    resolveEventContainerPaths({
      containerPathByManifestHash: index(values),
      dependencyManifestHashes: values.map((head) => head.manifestHash),
    });
  expect(
    resolve(heads.slice(0, 100)).dependencyContainerPaths.at(-1),
  ).toHaveLength(100);
  expect(() => resolve(heads)).toThrow("cyclic or too deep");
  const cycle = heads.slice(0, 2).map((head) => ({
    ...head,
    state: { ...head.state, parentContainerId: "container-1" },
  }));
  expect(() => resolve(cycle)).toThrow("cyclic or too deep");
});
