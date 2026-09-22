import { expect, test } from "bun:test";
import {
  createPrincipalReciteFixture as createFixture,
  GROUP_ID,
  ROOT_CONTAINER_ID,
} from "../../../../test/helpers/principalReciteFixtures";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../../data/containers/shared/projection";
import { buildMaterializedContainerCreatePlan } from "./create";
import { childContainerWriterProjectionFromCreatePlan } from "./createProjection";
import { refreshedPrincipalReferences } from "./sharePlanCore";

// A rekey substitutes a referenced principal head; it never adds one. A
// carried rekey below the container a policy is granted on passes that policy
// as its replacement, and a manifest may reference only principals it grants.

test("a replacement policy refreshes only a principal the container grants", async () => {
  const fixture = await createFixture({
    databaseName: "share-plan-core-refreshed-references",
    rotateKey: true,
  });
  try {
    const root =
      await fixture.input.apiClient.getContainerWriterProjection(
        ROOT_CONTAINER_ID,
      );
    if (!root) throw new Error("Expected root projection");
    const rootState = readContainerState(
      getTargetContainerContext(root).manifest,
    );
    const replacement = fixture.input.nextPolicy;
    expect(
      refreshedPrincipalReferences({
        previousState: rootState,
        replacementPrincipalPolicy: replacement,
      }).find((head) => head.principalId === GROUP_ID),
    ).toMatchObject({
      keyEpoch: replacement.keyEpoch,
      stateHash: replacement.stateHash,
      version: replacement.version,
    });

    // A child created without the grant: the reference stays absent.
    const child = childContainerWriterProjectionFromCreatePlan({
      materializedPlan: await buildMaterializedContainerCreatePlan({
        author: fixture.input.author,
        containerId: "ungranted-child",
        execSql: fixture.database.execSql,
        parentProjection: root,
        parentSecretKey: fixture.input.targetSecretKey,
        resolveProjectionUserKey: fixture.input.resolveTrustedUserIdentity,
      }),
      parentProjection: root,
    });
    const childState = readContainerState(
      getTargetContainerContext(child).manifest,
    );
    expect(childState.referencedPrincipalHeads).toEqual([]);
    expect(
      refreshedPrincipalReferences({
        previousState: childState,
        replacementPrincipalPolicy: replacement,
      }),
    ).toEqual([]);
  } finally {
    fixture.database.close();
  }
});
