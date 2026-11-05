import { expect, test } from "bun:test";
import { resolveContainerStatePathUserAccessLevel } from "@tearleads/crypto";
import {
  createPrincipalReciteFixture as createFixture,
  GROUP_ID,
  ROOT_CONTAINER_ID,
} from "../../../../test/helpers/principalReciteFixtures";
import { readContainerState } from "../../../data/containers/shared/projection";
import { buildMaterializedContainerCreatePlan } from "../child/create";
import { childContainerWriterProjectionFromCreatePlan } from "../child/create/createProjection";
import { preparePrincipalContainerRematerializationBatch } from "./principalContainerRematerialization";

const CHILD_CONTAINER_ID = "a-revoked-group-child";

// A signer whose only admin path to a child is the group's grant on the root
// (the Admins group in a new organization) revokes that group's direct grant
// on the child. The root rekey in the same batch cites the group's successor
// policy, so the server can authorize the revoke only if the revoke cites
// that successor too; citing nothing leaves the signer without access.
test("a group revoke cites the group's successor policy that authorizes its signer", async () => {
  const fixture = await createFixture({
    containerIds: [ROOT_CONTAINER_ID, CHILD_CONTAINER_ID],
    databaseName: "principal-container-rematerialization-revoke-authority",
    rotateKey: true,
  });
  try {
    const parentProjection =
      await fixture.input.apiClient.getContainerWriterProjection(
        ROOT_CONTAINER_ID,
      );
    if (!parentProjection) throw new Error("Expected parent projection");
    const previous = fixture.previousBundle.currentState;
    const materializedPlan = await buildMaterializedContainerCreatePlan({
      author: fixture.input.author,
      containerId: CHILD_CONTAINER_ID,
      execSql: fixture.database.execSql,
      managedPrincipalGrant: {
        accessLevel: "write",
        principalEncapsulationPublicKey: previous.encapsulationPublicKey,
        principalHead: {
          keyEpoch: previous.keyEpoch,
          keyFingerprint: previous.keyFingerprint,
          principalId: previous.principalId,
          principalType: "group",
          stateHash: previous.stateHash,
          version: previous.version,
        },
      },
      parentProjection,
      parentSecretKey: fixture.input.targetSecretKey,
      resolveProjectionUserKey: fixture.input.resolveTrustedUserIdentity,
      warmReferencedPrincipalPolicies:
        fixture.input.warmReferencedPrincipalPolicies,
    });
    const childProjection = childContainerWriterProjectionFromCreatePlan({
      materializedPlan,
      parentProjection,
    });
    fixture.serveProjection(childProjection);
    const childManifest = childProjection.path.at(-1);
    if (!childManifest) throw new Error("Expected child manifest");

    const prepared = await preparePrincipalContainerRematerializationBatch({
      ...fixture.input,
      grants: [
        { accessLevel: "admin", containerId: ROOT_CONTAINER_ID },
        { accessLevel: "write", containerId: CHILD_CONTAINER_ID },
      ],
      nextPolicy: {
        ...fixture.input.nextPolicy,
        grants: [{ accessLevel: "admin", containerId: ROOT_CONTAINER_ID }],
      },
      revokedContainerId: CHILD_CONTAINER_ID,
    });
    const [rootRekey, childRevoke] = prepared.plans;
    if (!rootRekey || !childRevoke) throw new Error("Expected two plans");
    expect(Reflect.get(childRevoke.plan.request.event, "eventType")).toBe(
      "container.revoke",
    );

    const citedPolicies = [fixture.input.nextPolicy].filter((policy) =>
      childRevoke.plan.request.principalPolicyRefs.some(
        (ref) =>
          ref.principalType === policy.principalType &&
          ref.principalId === policy.principalId &&
          ref.stateHash === policy.stateHash,
      ),
    );
    expect(citedPolicies.map((policy) => policy.principalId)).toEqual([
      GROUP_ID,
    ]);
    // The server authorizes the revoke on its cited path: the rekeyed root
    // this batch commits, then the child before the revoke.
    expect(
      resolveContainerStatePathUserAccessLevel({
        states: [rootRekey.plan.state, readContainerState(childManifest)],
        principalPolicies: citedPolicies,
        userId: fixture.input.author.signerUserId,
      }),
    ).toBe("admin");
    // The revoked group keeps no grant, reference, or wrap on the child.
    expect(
      childRevoke.plan.state.directGrants.some(
        (grant) => grant.subjectId === GROUP_ID,
      ),
    ).toBe(false);
    expect(
      childRevoke.plan.wraps.some((wrap) => wrap.recipientId === GROUP_ID),
    ).toBe(false);
  } finally {
    fixture.database.close();
  }
});
