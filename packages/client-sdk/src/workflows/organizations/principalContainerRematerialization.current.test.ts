import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  verifyPrincipalPolicyCurrentSuccessor,
} from "@tearleads/crypto";
import { currentGroupMutationInput } from "../../../test/helpers/currentGroupMutation";
import { createSuccessorGroupPolicyBundle } from "../../../test/helpers/groupPolicyFixtures";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import {
  createPrincipalReciteFixture,
  ROOT_CONTAINER_ID,
} from "../../../test/helpers/principalReciteFixtures";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { resolveCurrentGroupMutationReferences } from "./currentGroupMutationReferences";
import { buildPrincipalContainerRematerializationBatch } from "./principalContainerRematerialization";

test.each(["grant", "rekey", "revoke"] as const)(
  "container %s planning accepts a genuine current-only successor",
  async (kind) => {
    const f = await createPrincipalReciteFixture({
      databaseName: `current-policy-container-${kind}`,
      rotateKey: kind !== "grant",
    });
    try {
      const { verifiedCurrentPolicy } = await currentGroupMutationInput(
        f.nextBundle,
        [
          {
            userId: f.nextBundle.currentState.signerUserId,
            signingKeyFingerprint: f.input.author.signerKeyFingerprint,
            signingPublicKey: f.signingPublicKey,
          },
        ],
        [principalPolicyHead(f.previousBundle)],
      );
      expect(verifiedCurrentPolicy).not.toHaveProperty("history");
      const requests = await buildPrincipalContainerRematerializationBatch({
        ...f.input,
        nextPolicy: verifiedCurrentPolicy,
        ...(kind === "revoke" ? { revokedContainerId: ROOT_CONTAINER_ID } : {}),
      });
      expect(
        requests.map((request) => Reflect.get(request.event, "eventType")),
      ).toEqual([`container.${kind}`]);
      expect(f.requestedContainerIds).toEqual([ROOT_CONTAINER_ID]);
    } finally {
      f.database.close();
    }
  },
);

test("rematerialization selects an older citation without admitting the authored successor", async () => {
  const f = await createPrincipalReciteFixture({
    databaseName: "current-policy-old-citation",
    rotateKey: true,
  });
  try {
    const identity = await f.input.resolveTrustedUserIdentity(
      f.input.author.signerUserId,
    );
    if (!identity) throw new Error("Missing signer");
    const keys = [
      {
        userId: identity.userId,
        signingKeyFingerprint: identity.signingKeyFingerprint,
        signingPublicKey: f.signingPublicKey,
      },
    ];
    const predecessor = await currentGroupMutationInput(f.nextBundle, keys);
    const selected = await currentGroupMutationInput(f.nextBundle, keys, [
      principalPolicyHead(f.previousBundle),
    ]);
    const third = await createSuccessorGroupPolicyBundle({
      author: f.input.author,
      groupId: f.input.groupId,
      groupKem: generateKemSeedAndKeyPair(),
      keyEpoch: 3,
      memberPublicKey: identity.encapsulationPublicKey,
      previousBundle: f.nextBundle,
      signedAt: "2026-04-29T12:00:00.000Z",
      userId: identity.userId,
      signerUserId: identity.userId,
    });
    const checked = await verifyPrincipalPolicyCurrentSuccessor({
      previous: predecessor.verifiedCurrentPolicy,
      current: third,
      signerPublicKeys: keys,
    });
    if (!checked.ok) throw checked.error;
    const requested: number[] = [];
    const plans = await buildPrincipalContainerRematerializationBatch({
      ...f.input,
      nextPolicy: checked.value,
      resolveAuthoredPolicyReferences: (current, references) =>
        resolveCurrentGroupMutationReferences({
          current,
          references,
          predecessor: predecessor.verifiedCurrentPolicy,
          stillCurrent: () => true,
          readPredecessorReference: async (reference) => {
            requested.push(reference.version);
            return selected.verifiedCurrentPolicy;
          },
        }),
    });
    expect(requested).toEqual([1]);
    expect(plans.map((plan) => Reflect.get(plan.event, "eventType"))).toEqual([
      "container.rekey",
    ]);
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.input.execSql,
        "group",
        f.input.groupId,
      ),
    ).toMatchObject({ version: 1 });
  } finally {
    f.database.close();
  }
});
