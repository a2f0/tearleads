import { expect, test } from "bun:test";
import { createMutationResponseFromRequest } from "../../../test/helpers/containerFixtures";
import {
  createPrincipalReciteFixture as createFixture,
  GROUP_ID,
  ORGANIZATION_ID,
  ROOT_CONTAINER_ID,
  SECOND_CONTAINER_ID,
} from "../../../test/helpers/principalReciteFixtures";
import { heldContainerSnapshot } from "../../data/containers/shared/heldContainerHeads";
import { verifyContainerWriterProjection } from "../../data/keyingProjectionVerification";
import { advanceKeyingCheckpointsAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { buildMaterializedContainerCreatePlan } from "../containers/child/create";
import { childContainerWriterProjectionFromCreatePlan } from "../containers/child/createProjection";
import {
  buildPrincipalContainerRematerializationBatch,
  preparePrincipalContainerRematerializationBatch,
} from "./principalContainerRematerialization";

function eventType(request: { readonly event: Record<string, unknown> }) {
  return Reflect.get(request.event, "eventType");
}

test("rematerialization re-cites in the signed plans' organization, not the caller's current one", async () => {
  const fixture = await createFixture({
    databaseName: "principal-recite-plan-organization",
    rotateKey: false,
  });
  let active = true;
  const recited = Promise.withResolvers<Record<string, unknown>>();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const parentProjection =
      await fixture.input.apiClient.getContainerWriterProjection(
        ROOT_CONTAINER_ID,
      );
    if (!parentProjection) throw new Error("Expected parent projection");
    const materializedPlan = await buildMaterializedContainerCreatePlan({
      author: fixture.input.author,
      containerId: "held-rematerialized-child",
      execSql: fixture.database.execSql,
      parentProjection,
      parentSecretKey: fixture.input.targetSecretKey,
      resolveProjectionUserKey: fixture.input.resolveTrustedUserIdentity,
    });
    await verifyContainerWriterProjection({
      execSql: fixture.database.execSql,
      projection: childContainerWriterProjectionFromCreatePlan({
        materializedPlan,
        parentProjection,
      }),
      resolveUserKey: fixture.input.resolveTrustedUserIdentity,
    });
    const prepared = await preparePrincipalContainerRematerializationBatch({
      ...fixture.input,
      author: { ...fixture.input.author, organizationId: "caller's-other-org" },
      stillCurrent: () => active,
      apiClient: {
        ...fixture.input.apiClient,
        reciteContainer: async (_id, request) => {
          recited.resolve(request.event);
          return null;
        },
      },
    });
    // The real group-policy commit pins its acknowledged policy before this
    // container acknowledgement schedules optional descendant work.
    await advanceKeyingCheckpointsAtomically({
      access: [],
      execSql: fixture.database.execSql,
      organizationId: ORGANIZATION_ID,
      policies: [fixture.input.nextPolicy],
    });
    await prepared.acknowledge(
      await Promise.all(
        prepared.requests.map((request) =>
          createMutationResponseFromRequest(
            request,
            parentProjection.containerKeks.at(-1),
          ),
        ),
      ),
    );
    timeout = setTimeout(
      () => recited.reject(new Error("Expected a held descendant re-citation")),
      2_000,
    );
    expect(await recited.promise).toMatchObject({
      organizationId: ORGANIZATION_ID,
      objectId: "held-rematerialized-child",
      eventType: "container.recite",
    });
    const snapshot = heldContainerSnapshot(
      fixture.database.execSql,
      ORGANIZATION_ID,
    );
    expect(
      snapshot.policies.find((policy) => policy.principalId === GROUP_ID)
        ?.stateHash,
    ).toBe(fixture.input.nextPolicy.stateHash);
    expect(
      heldContainerSnapshot(fixture.database.execSql, "caller's-other-org")
        .policies,
    ).toEqual([]);
  } finally {
    active = false;
    clearTimeout(timeout);
    fixture.database.close();
  }
});

test("a refused rematerialization acknowledgement cannot cache a head when its guard revives", async () => {
  const fixture = await createFixture({
    databaseName: "principal-recite-refused-commit",
    rotateKey: false,
  });
  try {
    const parentProjection =
      await fixture.input.apiClient.getContainerWriterProjection(
        ROOT_CONTAINER_ID,
      );
    if (!parentProjection) throw new Error("Expected parent projection");
    const prepared = await preparePrincipalContainerRematerializationBatch(
      fixture.input,
    );
    const responses = await Promise.all(
      prepared.requests.map((request) =>
        createMutationResponseFromRequest(
          request,
          parentProjection.containerKeks.at(-1),
        ),
      ),
    );
    let permitted = false;
    await prepared.acknowledge(responses, () => {
      const result = permitted;
      permitted = true;
      return result;
    });
    const snapshot = heldContainerSnapshot(
      fixture.database.execSql,
      ORGANIZATION_ID,
    );
    expect(snapshot.heads.get(ROOT_CONTAINER_ID)?.bundle.manifestHash).toBe(
      parentProjection.path.at(-1)?.manifestHash,
    );
    expect(
      snapshot.policies.find((policy) => policy.principalId === GROUP_ID)
        ?.stateHash,
    ).not.toBe(fixture.input.nextPolicy.stateHash);
  } finally {
    fixture.database.close();
  }
});

test("principal rematerialization plans rekey and revoke branches", async () => {
  const fixture = await createFixture({
    databaseName: "principal-container-rematerialization-rotated",
    rotateKey: true,
  });
  try {
    const rekey = await buildPrincipalContainerRematerializationBatch(
      fixture.input,
    );
    const revoke = await buildPrincipalContainerRematerializationBatch({
      ...fixture.input,
      revokedContainerId: ROOT_CONTAINER_ID,
    });

    expect(rekey.map(eventType)).toEqual(["container.rekey"]);
    expect(revoke.map(eventType)).toEqual(["container.revoke"]);
  } finally {
    fixture.database.close();
  }
});

test("principal rematerialization plans a same-key-epoch grant refresh", async () => {
  const fixture = await createFixture({
    databaseName: "principal-container-rematerialization-same-epoch",
    rotateKey: false,
  });
  try {
    const requests = await buildPrincipalContainerRematerializationBatch(
      fixture.input,
    );

    expect(requests.map(eventType)).toEqual(["container.grant"]);
  } finally {
    fixture.database.close();
  }
});

test("principal rematerialization rejects stale grant inputs before commit", async () => {
  const fixture = await createFixture({
    databaseName: "principal-container-rematerialization-validation",
    rotateKey: true,
  });
  try {
    const [grant] = fixture.grants;
    if (!grant) {
      throw new Error("Expected fixture grant");
    }
    await expect(
      buildPrincipalContainerRematerializationBatch({
        ...fixture.input,
        grants: [{ ...grant, accessLevel: "read" }],
      }),
    ).rejects.toThrow("does not contain the expected group grant");
    await expect(
      buildPrincipalContainerRematerializationBatch({
        ...fixture.input,
        grants: [],
        revokedContainerId: ROOT_CONTAINER_ID,
      }),
    ).rejects.toThrow("Revoked container is not granted to the group");
  } finally {
    fixture.database.close();
  }
});

test("principal rematerialization enumerates every signed grant", async () => {
  const fixture = await createFixture({
    containerIds: [ROOT_CONTAINER_ID, SECOND_CONTAINER_ID],
    databaseName: "principal-container-rematerialization-complete-set",
    rotateKey: true,
  });
  try {
    const requests = await buildPrincipalContainerRematerializationBatch(
      fixture.input,
    );

    expect(requests).toHaveLength(2);
    expect(fixture.requestedContainerIds.toSorted()).toEqual([
      ROOT_CONTAINER_ID,
      SECOND_CONTAINER_ID,
    ]);
  } finally {
    fixture.database.close();
  }
});
