import { expect, test } from "bun:test";
import {
  createPrincipalReciteFixture,
  ROOT_CONTAINER_ID,
} from "../../../../test/helpers/principalReciteFixtures";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { buildMaterializedContainerCreatePlan } from "../child/create";
import { childContainerWriterProjectionFromCreatePlan } from "../child/create/createProjection";
import {
  containerWriterProjectionFromRotationPlan,
  rebaseContainerWriterProjection,
} from "../child/rekey/rekeyProjection";
import { preparePrincipalContainerRematerializationBatch } from "./principalContainerRematerialization";
import {
  type BatchPlanning,
  rerootOnAuthoredPaths,
} from "./principalContainerRematerializationPlanning";

test.each([false, true])(
  "rerooting persists only served checkpoints (already speculative: %s)",
  async (speculative) => {
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
      const child = childContainerWriterProjectionFromCreatePlan({
        parentProjection: parent,
        materializedPlan: await buildMaterializedContainerCreatePlan({
          author: fixture.input.author,
          containerId: "unpinned-child",
          execSql: fixture.database.execSql,
          parentProjection: parent,
          parentSecretKey: fixture.input.targetSecretKey,
          resolveProjectionUserKey: fixture.input.resolveTrustedUserIdentity,
          warmReferencedPrincipalPolicies:
            fixture.input.warmReferencedPrincipalPolicies,
        }),
      });
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
      const batch: BatchPlanning = {
        authoredAbove: [successor],
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
      const servedParentPin = await checkpoint(ROOT_CONTAINER_ID);
      const input = speculative
        ? rebaseContainerWriterProjection(child, successor)
        : child;
      if (!input) throw new Error("Expected child projection");
      const result = await rerootOnAuthoredPaths(batch, input);
      expect(result.path.map((entry) => entry.manifestHash)).toEqual([
        root.plan.manifestHash,
        childHash,
      ]);
      // Planning never admits the uncommitted ancestor, even when a served
      // descendant must be pinned before its own acknowledgement.
      expect(await checkpoint(ROOT_CONTAINER_ID)).toEqual(servedParentPin);
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
