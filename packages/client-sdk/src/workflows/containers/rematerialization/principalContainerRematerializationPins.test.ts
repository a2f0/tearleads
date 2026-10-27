import { expect, test } from "bun:test";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createPrincipalReciteFixture,
  ROOT_CONTAINER_ID,
} from "../../../../test/helpers/principalReciteFixtures";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { buildMaterializedContainerCreatePlan } from "../child/create";
import { childContainerWriterProjectionFromCreatePlan } from "../child/create/createProjection";
import { buildMaterializedContainerRekeyPlan } from "../child/rekey";
import {
  containerWriterProjectionFromRotationPlan,
  rebaseContainerWriterProjection,
} from "../child/rekey/rekeyProjection";
import { preparePrincipalContainerRematerializationBatch } from "./principalContainerRematerialization";
import {
  type BatchPlanning,
  rerootOnAuthoredPaths,
} from "./principalContainerRematerializationPlanning";

async function makeDescendant(
  fixture: Awaited<ReturnType<typeof createPrincipalReciteFixture>>,
  parent: ContainerWriterProjectionResponse,
  depth: number,
) {
  let descendant = parent;
  let firstChild = parent;
  for (let level = 1; level <= depth; level += 1) {
    descendant = childContainerWriterProjectionFromCreatePlan({
      parentProjection: descendant,
      materializedPlan: await buildMaterializedContainerCreatePlan({
        author: fixture.input.author,
        containerId: `child-${level}`,
        execSql: fixture.database.execSql,
        parentProjection: descendant,
        parentSecretKey: fixture.input.targetSecretKey,
        resolveProjectionUserKey: fixture.input.resolveTrustedUserIdentity,
        warmReferencedPrincipalPolicies:
          fixture.input.warmReferencedPrincipalPolicies,
      }),
    });
    if (level === 1) firstChild = descendant;
  }
  return { child: descendant, firstChild };
}

async function makeAuthoredPrefix(
  fixture: Awaited<ReturnType<typeof createPrincipalReciteFixture>>,
  served: ContainerWriterProjectionResponse,
  successor: ContainerWriterProjectionResponse,
) {
  const rotated = await buildMaterializedContainerRekeyPlan({
    author: fixture.input.author,
    execSql: fixture.database.execSql,
    previousProjection: served,
    targetSecretKey: fixture.input.targetSecretKey,
    resolveProjectionUserKey: fixture.input.resolveTrustedUserIdentity,
    warmReferencedPrincipalPolicies:
      fixture.input.warmReferencedPrincipalPolicies,
    persistVerificationCheckpoints: false,
  });
  const prefix = rebaseContainerWriterProjection(
    rotated.writerProjection,
    successor,
  );
  if (!prefix) throw new Error("Expected authored intermediate path");
  return prefix;
}

test.each([
  [false, 1],
  [true, 1],
  [false, 3],
  [true, 3],
] as const)(
  "rerooting persists only served checkpoints (speculative: %s, depth: %s)",
  async (speculative, depth) => {
    const fixture = await createPrincipalReciteFixture({
      databaseName: "rematerialization-served-pins",
      rotateKey: true,
    });
    try {
      const parent =
        await fixture.input.apiClient.getContainerWriterProjection(
          ROOT_CONTAINER_ID,
        );
      if (!parent) throw new Error("Expected parent projection");
      const { child, firstChild } = await makeDescendant(
        fixture,
        parent,
        depth,
      );
      const prepared = await preparePrincipalContainerRematerializationBatch(
        fixture.input,
      );
      const root = prepared.plans[0];
      if (!root || !("keyring" in root.plan))
        throw new Error("Expected rotation");
      const successor = await containerWriterProjectionFromRotationPlan({
        plan: root.plan,
        previousProjection: parent,
      });
      const prefix =
        depth === 1
          ? successor
          : await makeAuthoredPrefix(fixture, firstChild, successor);
      const batch: BatchPlanning = {
        authoredAbove: [prefix, successor],
        knownContainerKeks: new Map(),
        plans: [],
        principalPolicyCache: new Map(),
        rematerialization: fixture.input,
        resolveProjectionUserKey: fixture.input.resolveTrustedUserIdentity,
        rotatedAbove: [successor],
      };
      const childHash = child.path.at(-1)?.manifestHash;
      if (!childHash) throw new Error("Expected child manifest");
      const checkpoint = (id: string) =>
        loadAccessManifestCheckpoint(
          fixture.database.execSql,
          "container",
          parent.organizationId,
          id,
        );
      expect(await checkpoint(child.containerId)).toBeNull();
      const pins = () =>
        Promise.all([
          checkpoint(ROOT_CONTAINER_ID),
          checkpoint(prefix.containerId),
        ]);
      const servedParentPins = await pins();
      const input = speculative
        ? rebaseContainerWriterProjection(child, successor)
        : child;
      if (!input) throw new Error("Expected child projection");
      const result = await rerootOnAuthoredPaths(batch, input);
      expect(result.path.map((entry) => entry.manifestHash)).toEqual([
        ...prefix.path.map((entry) => entry.manifestHash),
        ...child.path
          .slice(prefix.path.length)
          .map((entry) => entry.manifestHash),
      ]);
      // Planning never admits the uncommitted ancestor, even when a served
      // descendant must be pinned before its own acknowledgement.
      expect(await pins()).toEqual(servedParentPins);
      expect(await checkpoint(child.containerId)).toEqual(
        speculative
          ? null
          : {
              objectKind: "container",
              objectId: child.containerId,
              organizationId: parent.organizationId,
              epoch: 1,
              manifestHash: childHash,
            },
      );
    } finally {
      fixture.database.close();
    }
  },
);
