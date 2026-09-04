import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  normalizeContainerAccessEventBody,
  verifyContainerAccessManifest,
} from "./index";
import {
  createContainerManifestFixture,
  createVerifiedContainerAccessEvent,
} from "./testFixtures";

async function recite(
  input: { signerUserId?: string; keyEpochId?: string } = {},
) {
  const signer = generateSigningSeedAndKeyPair();
  const parent = await createContainerManifestFixture({
    containerId: "parent",
    directGrants: [
      { subjectType: "user", subjectId: "owner", accessLevel: "admin" },
    ],
    signer,
    signerUserId: "owner",
  });
  const previous = await createContainerManifestFixture({
    containerId: "empty-child",
    containerKeyEpochId: "child-key",
    directGrants: [],
    parentContainerId: parent.state.containerId,
    parentManifestHash: parent.manifestHash,
    signer,
    signerUserId: "owner",
  });
  const event = await createVerifiedContainerAccessEvent({
    body: {
      eventType: "container.recite",
      containerKeyEpochId: input.keyEpochId ?? "child-key",
    },
    dependencyManifestHashes: [parent.manifestHash, previous.manifestHash],
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: previous.manifestHash,
    signer,
    signerUserId: input.signerUserId ?? "owner",
  });
  const state = {
    ...previous.state,
    epoch: previous.state.epoch + 1,
    previousManifestHash: previous.manifestHash,
    eventHash: event.eventHash,
  };
  const manifest = await deriveContainerAccessManifest(state);
  const result = await verifyContainerAccessManifest({
    event,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    manifest,
    previousManifest: previous,
    previousContainerPath: [parent, previous],
  });
  return { result, state };
}

test("recitation advances the access head without changing an empty child's grants or keys", async () => {
  const { result, state } = await recite();
  if (!result.ok) throw result.error;
  expect(result.value.state).toEqual(state);
  expect(result.value.state.directGrants).toEqual([]);
  expect(result.value.state.containerKeyEpochId).toBe("child-key");
});

test("recitation requires admin access through its authorization path", async () => {
  const { result } = await recite({ signerUserId: "stranger" });
  expect(result).toMatchObject({ ok: false, error: { code: "unauthorized" } });
});

test("recitation cannot change the key epoch", async () => {
  const { result } = await recite({ keyEpochId: "different-key" });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "key_epoch_reuse" },
  });
});

test("recitation bodies cannot carry grants or rotation artifacts", () => {
  for (const key of ["grant", "referencedPrincipalHead", "keyringHash"]) {
    expect(() =>
      normalizeContainerAccessEventBody({
        eventType: "container.recite",
        containerKeyEpochId: "child-key",
        [key]: "unexpected",
      }),
    ).toThrow();
  }
});

test("recitation normalizes the same nullable key state as an unrotated grant", () => {
  expect(
    normalizeContainerAccessEventBody({
      eventType: "container.recite",
      containerKeyEpochId: null,
    }),
  ).toEqual({ eventType: "container.recite", containerKeyEpochId: null });
});
