import { expect, test } from "bun:test";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  createPrincipalReciteFixture as createFixture,
  ROOT_CONTAINER_ID,
} from "../../../test/helpers/principalReciteFixtures";
import { buildMaterializedContainerCreatePlan } from "../containers/child/create";
import { childContainerWriterProjectionFromCreatePlan } from "../containers/child/createProjection";
import { preparePrincipalContainerRematerializationBatch } from "./principalContainerRematerialization";

const MID_CONTAINER_ID = "a-mid-child";
const NESTED_CONTAINER_ID = "a-nested-group-child";
const DEEP_CONTAINER_ID = "a-deep-child";

type Fixture = Awaited<ReturnType<typeof createFixture>>;

/** Create a child under `parent` and serve it; `granted` adds the group's grant. */
async function serveChild(
  fixture: Fixture,
  parent: ContainerWriterProjectionResponse,
  containerId: string,
  granted: boolean,
): Promise<ContainerWriterProjectionResponse> {
  const previous = fixture.previousBundle.currentState;
  const materializedPlan = await buildMaterializedContainerCreatePlan({
    author: fixture.input.author,
    containerId,
    execSql: fixture.database.execSql,
    managedPrincipalGrant: granted
      ? {
          accessLevel: "admin",
          principalEncapsulationPublicKey: previous.encapsulationPublicKey,
          principalHead: {
            keyEpoch: previous.keyEpoch,
            keyFingerprint: previous.keyFingerprint,
            principalId: previous.principalId,
            principalType: "group",
            stateHash: previous.stateHash,
            version: previous.version,
          },
        }
      : undefined,
    parentProjection: parent,
    parentSecretKey: fixture.input.targetSecretKey,
    resolveProjectionUserKey: fixture.input.resolveTrustedUserIdentity,
  });
  const projection = childContainerWriterProjectionFromCreatePlan({
    materializedPlan,
    parentProjection: parent,
  });
  fixture.serveProjection(projection);
  return projection;
}

function objectIds(requests: readonly { readonly event: object }[]) {
  return requests.map((request) => Reflect.get(request.event, "objectId"));
}

// #2340 finding 1, with real keys. The group is granted on the root and on a
// grandchild, with an ungranted level between. Rotating the root strands that
// level, and the grandchild's own rekey cannot be signed on a stale path, so
// the batch carries the level itself, parent-first, without being told.

test("a batch carries the stale level between two of its own rotations", async () => {
  const fixture = await createFixture({
    containerIds: [ROOT_CONTAINER_ID, NESTED_CONTAINER_ID],
    databaseName: "principal-container-rematerialization-carry-between",
    rotateKey: true,
  });
  try {
    const root =
      await fixture.input.apiClient.getContainerWriterProjection(
        ROOT_CONTAINER_ID,
      );
    if (!root) throw new Error("Expected root projection");
    const mid = await serveChild(fixture, root, MID_CONTAINER_ID, false);
    await serveChild(fixture, mid, NESTED_CONTAINER_ID, true);

    const prepared = await preparePrincipalContainerRematerializationBatch(
      fixture.input,
    );
    expect(objectIds(prepared.requests)).toEqual([
      ROOT_CONTAINER_ID,
      MID_CONTAINER_ID,
      NESTED_CONTAINER_ID,
    ]);
    const [rootRekey, midRekey, nestedRekey] = prepared.plans;
    if (
      !rootRekey ||
      !midRekey ||
      !nestedRekey ||
      !("keyring" in rootRekey.plan) ||
      !("keyring" in midRekey.plan) ||
      !("keyring" in nestedRekey.plan)
    ) {
      throw new Error("Expected three rotation plans");
    }
    expect(midRekey.plan.body.eventType).toBe("container.rekey");
    expect(midRekey.plan.keyEpoch.parentContainerKeyEpochId).toBe(
      rootRekey.plan.containerKeyEpochId,
    );
    expect(nestedRekey.plan.keyEpoch.parentContainerKeyEpochId).toBe(
      midRekey.plan.containerKeyEpochId,
    );
    expect(
      nestedRekey.plan.request.previousContainerPath
        ?.slice(0, -1)
        .map((entry) => entry.manifestHash),
    ).toEqual([rootRekey.plan.manifestHash, midRekey.plan.manifestHash]);
  } finally {
    fixture.database.close();
  }
});

// The same tree with a user granted two levels below the grandchild. The
// server names the whole owed chain — the level the batch already carries,
// the grandchild the batch already rotates, and the level beneath it — and
// the answer is one parent-first batch: each named container rotated once,
// the batch's own rotations re-signed under what is now carried above them.

test("carry weaves the named levels into the batch parent-first, re-planning its own rotations beneath them", async () => {
  const fixture = await createFixture({
    containerIds: [ROOT_CONTAINER_ID, NESTED_CONTAINER_ID],
    databaseName: "principal-container-rematerialization-carry",
    rotateKey: true,
  });
  try {
    const root =
      await fixture.input.apiClient.getContainerWriterProjection(
        ROOT_CONTAINER_ID,
      );
    if (!root) throw new Error("Expected root projection");
    const mid = await serveChild(fixture, root, MID_CONTAINER_ID, false);
    const nested = await serveChild(fixture, mid, NESTED_CONTAINER_ID, true);
    await serveChild(fixture, nested, DEEP_CONTAINER_ID, false);

    const prepared = await preparePrincipalContainerRematerializationBatch(
      fixture.input,
    );
    const firstNested = prepared.plans[2];
    if (!firstNested || !("keyring" in firstNested.plan)) {
      throw new Error("Expected the nested grant to rotate");
    }

    const carried = await prepared.carry([
      DEEP_CONTAINER_ID,
      NESTED_CONTAINER_ID,
      MID_CONTAINER_ID,
    ]);
    expect(objectIds(carried)).toEqual([
      ROOT_CONTAINER_ID,
      MID_CONTAINER_ID,
      NESTED_CONTAINER_ID,
      DEEP_CONTAINER_ID,
    ]);
    expect(objectIds(prepared.requests)).toEqual(objectIds(carried));
    const [rootRekey, midRekey, nestedRekey, deepRekey] = prepared.plans;
    if (
      !rootRekey ||
      !midRekey ||
      !nestedRekey ||
      !deepRekey ||
      !("keyring" in rootRekey.plan) ||
      !("keyring" in midRekey.plan) ||
      !("keyring" in nestedRekey.plan) ||
      !("keyring" in deepRekey.plan)
    ) {
      throw new Error("Expected four rotation plans");
    }
    expect(nestedRekey.plan.keyEpoch.parentContainerKeyEpochId).toBe(
      midRekey.plan.containerKeyEpochId,
    );
    expect(deepRekey.plan.keyEpoch.parentContainerKeyEpochId).toBe(
      nestedRekey.plan.containerKeyEpochId,
    );
    expect(
      deepRekey.plan.request.previousContainerPath
        ?.slice(0, -1)
        .map((entry) => entry.manifestHash),
    ).toEqual([
      rootRekey.plan.manifestHash,
      midRekey.plan.manifestHash,
      nestedRekey.plan.manifestHash,
    ]);
    // Re-signed from the served head under a fresh chain: not a rotation of
    // its own first rotation.
    expect(nestedRekey.plan.previousManifest.manifestHash).toBe(
      firstNested.plan.previousManifest.manifestHash,
    );
    expect(nestedRekey.plan.containerKeyEpochId).not.toBe(
      firstNested.plan.containerKeyEpochId,
    );
  } finally {
    fixture.database.close();
  }
});

test("carry refuses a named level the batch would only grant", async () => {
  const fixture = await createFixture({
    containerIds: [ROOT_CONTAINER_ID],
    databaseName: "principal-container-rematerialization-carry-grant",
    rotateKey: false,
  });
  try {
    const prepared = await preparePrincipalContainerRematerializationBatch(
      fixture.input,
    );
    expect(
      prepared.plans.every((planned) => !("keyring" in planned.plan)),
    ).toBe(true);
    await expect(prepared.carry([ROOT_CONTAINER_ID])).rejects.toThrow(
      `Container ${ROOT_CONTAINER_ID} needs a rekey this policy change only grants`,
    );
  } finally {
    fixture.database.close();
  }
});
