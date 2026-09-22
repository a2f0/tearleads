import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isCommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { MAX_ROTATION_CONTAINER_REKEYS } from "@tearleads/validators/util";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildContainerGrantRequest } from "../../../test/helpers/containerGrantMutation";
import { buildRekeyRequest } from "../../../test/helpers/containerMutationRotations";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import {
  prepareRotation,
  putPolicy,
} from "../../../test/helpers/policyRotationFixture";
import { registerUser } from "../../../test/helpers/registerUser";
import { getCurrentContainerKeyEpoch } from "../../access/read/containerKekStore";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

// #2340 finding 1. A policy rotation rematerializes the root, which is a
// rotation like any other: with a user granted two levels below it, the
// intermediate would be left pinned to a retired epoch and its grantee could
// never re-key it. The commit is refused whole, names the level, and commits
// only with that rekey carried after the rematerializations.

test("a policy rotation carries the levels above a granted container", async () => {
  const grantee = createTestUser();
  await registerUser(grantee);
  await authenticate(grantee);
  let tree: {
    lower: string;
    upper: string;
    upperBundle: ReturnType<typeof accessManifestFromContainerResponse>;
    upperKek: ReturnType<typeof kekStateFromContainerResponse>;
  } | null = null;
  const prepared = await prepareRotation({
    beforeSigning: async (owner, root) => {
      const upper = await createChildContainer({ parent: root, signer: owner });
      const upperBundle = accessManifestFromContainerResponse(upper);
      const upperKek = kekStateFromContainerResponse(upper);
      const lower = await createChildContainer({
        parent: { bundle: upperBundle, kekState: upperKek },
        parentPath: [root.bundle],
        signer: owner,
      });
      const lowerBundle = accessManifestFromContainerResponse(lower);
      const granted = await routeApp.request(
        `/containers/${lower.containerId}/share`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${owner.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            await buildContainerGrantRequest({
              parentKekState: upperKek,
              previous: lowerBundle,
              previousContainerPath: [root.bundle, upperBundle, lowerBundle],
              previousKekState: kekStateFromContainerResponse(lower),
              recipient: grantee,
              signer: owner,
            }),
          ),
        },
      );
      expect(granted.status, (await granted.clone().text()).slice(0, 300)).toBe(
        200,
      );
      tree = {
        lower: lower.containerId,
        upper: upper.containerId,
        upperBundle,
        upperKek,
      };
      // Creating children never moves the root's head or epoch.
      return root;
    },
  });
  invariant(tree, "expected the tree");
  const { upper, upperBundle, upperKek } = tree;

  const refused = await putPolicy(prepared);
  expect(refused.status, (await refused.clone().text()).slice(0, 300)).toBe(
    409,
  );
  expect(await refused.json()).toMatchObject({
    code: "container_descendant_rekeys_required",
    requiredContainerIds: [upper],
  });
  // Refused whole: the policy did not advance either.
  expect(
    (
      await getCurrentPrincipalState(
        "group",
        prepared.nextPolicy.principalId,
        db,
      )
    )?.stateHash,
  ).toBe(prepared.currentPolicy.stateHash);

  // Carried after the rematerializations, signed against the root epoch the
  // same batch mints.
  const carriedUpper = await buildRekeyRequest({
    parentKekState: prepared.rootRekey.kekState,
    previous: upperBundle,
    previousContainerPath: [prepared.rootRekey.bundle, upperBundle],
    previousKekState: upperKek,
    // The path cites the policy this very batch rotates, so like the root
    // rekey it must cite the successor.
    replacementPrincipalPolicy: prepared.nextPolicy,
    signer: prepared.owner,
  });
  const committed = await putPolicy(prepared, [
    ...prepared.containerMutations,
    carriedUpper,
  ]);
  expect(committed.status, (await committed.clone().text()).slice(0, 300)).toBe(
    200,
  );
  const body: unknown = await committed.json();
  invariant(isCommitOrganizationGroupPolicyResponse(body), "expected commit");
  // One acknowledgement per request, the carried one last.
  expect(
    body.groupPolicy.containerMutations.map((m) => m.containerId).at(-1),
  ).toBe(upper);
  const upperEpoch = await getCurrentContainerKeyEpoch(upper, db);
  expect(upperEpoch?.parentContainerKeyEpochId).toBe(
    prepared.rootRekey.kekState.containerKeyEpochId,
  );
}, 30_000);

// Beyond the required rematerializations a batch may carry only rekeys, and
// only so many: a grant or revoke there is not a repair, and the list is bounded
// like a rotation's.

test("a policy batch may carry only rekeys, and only up to the cap", async () => {
  const prepared = await prepareRotation();
  const rootGrant = prepared.containerMutations[0];
  invariant(rootGrant, "expected the root rematerialization");
  const notARekey = {
    ...rootGrant,
    body: { ...Object(rootGrant.body), eventType: "container.grant" },
    event: { ...Object(rootGrant.event), eventType: "container.grant" },
  };
  const refused = await putPolicy(prepared, [
    ...prepared.containerMutations,
    notARekey,
  ]);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({
    error:
      "Principal policy may carry only container rekeys beyond its rematerializations",
  });

  const overCap = await putPolicy(prepared, [
    ...prepared.containerMutations,
    ...Array.from(
      { length: MAX_ROTATION_CONTAINER_REKEYS + 1 },
      () => rootGrant,
    ),
  ]);
  expect(overCap.status).toBe(409);
  expect(await overCap.json()).toMatchObject({
    error: "Principal policy carries too many descendant rekeys",
  });
  // Neither attempt moved the policy.
  expect(
    (
      await getCurrentPrincipalState(
        "group",
        prepared.nextPolicy.principalId,
        db,
      )
    )?.stateHash,
  ).toBe(prepared.currentPolicy.stateHash);
}, 30_000);
