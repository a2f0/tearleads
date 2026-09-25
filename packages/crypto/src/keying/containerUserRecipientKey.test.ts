import { expect, test } from "bun:test";
import { verifyContainerKekState } from "./containerKek";
import { fixtureContainerKekMaterialId } from "./containerKekMaterial.testFixtures";
import {
  createContainerManifestFixture,
  createVerifiedContainerKekStateFixture,
  expectVerificationError,
  fixtureHash,
} from "./testFixtures";

test("KEK verification binds every user recipient label to its identity", async () => {
  const userId = "user";
  const manifest = await createContainerManifestFixture({
    containerId: "container",
    containerKeyEpochId: await fixtureContainerKekMaterialId(
      "key",
      "container",
    ),
    directGrants: [
      { subjectType: "user", subjectId: userId, accessLevel: "write" },
    ],
  });
  const state = await createVerifiedContainerKekStateFixture({
    manifest,
    recipientUserId: userId,
  });
  const wrap = state.wraps[0];
  if (!wrap) throw new Error("Missing fixture wrap");
  const verifyLabel = (recipientKeyEpochId: string) =>
    verifyContainerKekState({
      containerManifest: manifest,
      keyEpoch: state.keyEpoch,
      wraps: [{ ...wrap, recipientKeyEpochId }],
      userRecipientKeys: [
        {
          userId,
          recipientKeyEpochId,
          recipientKeyFingerprint: wrap.recipientKeyFingerprint,
        },
      ],
    });
  expect((await verifyLabel(wrap.recipientKeyEpochId)).ok).toBe(true);
  for (const label of [
    `user:another-user:encapsulation:${wrap.recipientKeyFingerprint}`,
    `user:${userId}:encapsulation:${await fixtureHash("another-key")}`,
    `user:${userId}:1:${wrap.recipientKeyFingerprint}`,
  ]) {
    expectVerificationError(await verifyLabel(label), "invalid_shape");
  }
});
