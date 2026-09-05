import { expect, test } from "bun:test";
import {
  KeyingVerificationError,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { createScenario } from "../../../test/helpers/ancestorCitationScenario";
import { addHistoricalContainerTargetPaths } from "./historicalContainerTargetPaths";

function reconstruct(heads: readonly VerifiedContainerAccessManifest[]) {
  const paths = new Map<string, readonly VerifiedContainerAccessManifest[]>();
  addHistoricalContainerTargetPaths({
    containerPathByManifestHash: paths,
    manifests: new Map(heads.map((head) => [head.manifestHash, head])),
  });
  return paths;
}

test("historical content targets retain only matching pinned ancestry", async () => {
  const { child1, root1, root2 } = await createScenario();
  expect(reconstruct([child1, root1, root2]).get(child1.manifestHash)).toEqual([
    root1,
    child1,
  ]);
  expect(reconstruct([child1, root2]).get(child1.manifestHash)).toEqual([
    child1,
  ]);
  // Structural corruption probes the index boundary, not signature validity.
  for (const state of [
    { ...root1.state, organizationId: "another-organization" },
    { ...root1.state, containerId: "another-container" },
  ]) {
    expect(
      reconstruct([child1, { ...root1, state }]).get(child1.manifestHash),
    ).toEqual([child1]);
  }
});

test("historical target reconstruction never replaces a checkpoint-enforced path", async () => {
  const { child1, root1, root2 } = await createScenario();
  const paths = new Map([[child1.manifestHash, [root2, child1]]]);
  addHistoricalContainerTargetPaths({
    containerPathByManifestHash: paths,
    manifests: new Map(
      [root1, child1].map((head) => [head.manifestHash, head]),
    ),
  });
  expect(paths.get(child1.manifestHash)).toEqual([root2, child1]);
});

test("historical target graph bounds fail with a classified verification error", async () => {
  const { root1 } = await createScenario();
  // Synthetic trusted-boundary graph: no abbreviated chain is verified here.
  const heads = Array.from({ length: 101 }, (_, index) => ({
    ...root1,
    manifestHash: `hash-${index}`,
    state: {
      ...root1.state,
      containerId: `id-${index}`,
      parentContainerId: index ? `id-${index - 1}` : null,
      parentManifestHash: index ? `hash-${index - 1}` : null,
    },
  }));
  expect(reconstruct(heads.slice(0, 100)).get("hash-99")).toHaveLength(100);
  expect(() => reconstruct(heads)).toThrow(KeyingVerificationError);
  const cycle = {
    ...root1,
    state: {
      ...root1.state,
      parentContainerId: root1.state.containerId,
      parentManifestHash: root1.manifestHash,
    },
  };
  expect(() => reconstruct([cycle])).toThrow(KeyingVerificationError);
});
