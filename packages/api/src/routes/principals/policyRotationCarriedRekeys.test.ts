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

  // Signed against the root epoch the same batch mints, and placed where the
  // client puts it: parent-first, between the rematerializations.
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
  const [rootRekey, ...metadataMutations] = prepared.containerMutations;
  invariant(rootRekey, "expected the root rekey");
  const committed = await putPolicy(prepared, [
    rootRekey,
    carriedUpper,
    ...metadataMutations,
  ]);
  expect(committed.status, (await committed.clone().text()).slice(0, 300)).toBe(
    200,
  );
  const body: unknown = await committed.json();
  invariant(isCommitOrganizationGroupPolicyResponse(body), "expected commit");
  // One acknowledgement per request, in the order submitted.
  expect(body.groupPolicy.containerMutations.map((m) => m.containerId)).toEqual(
    [
      prepared.rootRekey.kekState.containerId,
      upper,
      ...metadataMutations.map((m) =>
        String(Reflect.get(Object(m.event), "objectId")),
      ),
    ],
  );
  const upperEpoch = await getCurrentContainerKeyEpoch(upper, db);
  expect(upperEpoch?.parentContainerKeyEpochId).toBe(
    prepared.rootRekey.kekState.containerKeyEpochId,
  );
}, 30_000);

// Beyond the required rematerializations a batch may carry only rekeys, each
// of a container it does not otherwise rotate, only so many, and only when
// something in it rotates: a grant or revoke there is not a repair, a second
// rekey of one container is a rotation in disguise, and the list is bounded
// like a rotation's.

async function prepareWithUpper(rotateKey: boolean) {
  let upper: {
    bundle: ReturnType<typeof accessManifestFromContainerResponse>;
    kekState: ReturnType<typeof kekStateFromContainerResponse>;
  } | null = null;
  const prepared = await prepareRotation({
    beforeSigning: async (owner, root) => {
      const child = await createChildContainer({ parent: root, signer: owner });
      upper = {
        bundle: accessManifestFromContainerResponse(child),
        kekState: kekStateFromContainerResponse(child),
      };
      return root;
    },
    rotateKey,
  });
  invariant(upper, "expected the upper container");
  const { bundle, kekState } = upper;
  const carriedUpper = await buildRekeyRequest({
    parentKekState: prepared.rootRekey.kekState,
    previous: bundle,
    previousContainerPath: [prepared.rootRekey.bundle, bundle],
    previousKekState: kekState,
    replacementPrincipalPolicy: prepared.nextPolicy,
    signer: prepared.owner,
  });
  return { carriedUpper, prepared };
}

async function expectRefusal(
  response: Response,
  error: string,
  prepared: Awaited<ReturnType<typeof prepareRotation>>,
) {
  expect(response.status, (await response.clone().text()).slice(0, 300)).toBe(
    409,
  );
  expect(await response.json()).toMatchObject({ error });
  // The attempt did not move the policy.
  expect(
    (
      await getCurrentPrincipalState(
        "group",
        prepared.nextPolicy.principalId,
        db,
      )
    )?.stateHash,
  ).toBe(prepared.currentPolicy.stateHash);
}

test("a policy batch may carry only rekeys, once each, up to the cap", async () => {
  const { carriedUpper, prepared } = await prepareWithUpper(true);
  const notARekey = {
    ...carriedUpper,
    body: { ...Object(carriedUpper.body), eventType: "container.grant" },
    event: { ...Object(carriedUpper.event), eventType: "container.grant" },
  };
  await expectRefusal(
    await putPolicy(prepared, [...prepared.containerMutations, notARekey]),
    "Principal policy may carry only container rekeys beyond its rematerializations",
    prepared,
  );
  await expectRefusal(
    await putPolicy(prepared, [
      ...prepared.containerMutations,
      carriedUpper,
      carriedUpper,
    ]),
    "Principal policy rotates a container twice",
    prepared,
  );
  // A carried rekey of a container the batch rematerializes is a second
  // rotation of it, whatever it is called.
  const rootAgain = {
    ...carriedUpper,
    event: {
      ...Object(carriedUpper.event),
      objectId: prepared.rootRekey.kekState.containerId,
    },
  };
  await expectRefusal(
    await putPolicy(prepared, [...prepared.containerMutations, rootAgain]),
    "Principal policy container rematerialization batch is incomplete or invalid",
    prepared,
  );
  await expectRefusal(
    await putPolicy(prepared, [
      ...prepared.containerMutations,
      ...Array.from(
        { length: MAX_ROTATION_CONTAINER_REKEYS + 1 },
        (_, index) => ({
          ...carriedUpper,
          event: {
            ...Object(carriedUpper.event),
            objectId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          },
        }),
      ),
    ]),
    "Principal policy carries too many descendant rekeys",
    prepared,
  );
}, 30_000);

test("a policy batch that rotates nothing carries nothing", async () => {
  const { carriedUpper, prepared } = await prepareWithUpper(false);
  await expectRefusal(
    await putPolicy(prepared, [...prepared.containerMutations, carriedUpper]),
    "Principal policy carries descendant rekeys without a rotation",
    prepared,
  );
}, 30_000);
