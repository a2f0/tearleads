import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { MAX_CONTAINER_RECITATION_EPOCH } from "./containerAccessReciteBody";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  normalizeContainerAccessEventBody,
  verifyContainerAccessManifest,
} from "./index";
import {
  createContainerManifestFixture,
  createVerifiedContainerAccessEvent,
  fixtureHash,
} from "./testFixtures";

async function recite(
  input: {
    signerUserId?: string;
    keyEpochId?: string;
    previousEpoch?: number;
    withGrants?: boolean;
  } = {},
) {
  const signer = generateSigningSeedAndKeyPair();
  const parent = await createContainerManifestFixture({
    containerId: "parent",
    directGrants: [
      { subjectType: "user", subjectId: "owner", accessLevel: "admin" },
      { subjectType: "user", subjectId: "writer", accessLevel: "write" },
    ],
    signer,
    signerUserId: "owner",
  });
  const previous = await createContainerManifestFixture({
    containerId: "empty-child",
    // The fixture is the trusted predecessor boundary of this transition
    // test, not evidence that an abbreviated 1024-head chain verifies.
    epoch: input.previousEpoch ?? 1,
    containerKeyEpochId: "child-key",
    directGrants: input.withGrants
      ? [
          { subjectType: "group", subjectId: "readers", accessLevel: "read" },
          { subjectType: "user", subjectId: "owner", accessLevel: "admin" },
        ]
      : [],
    referencedPrincipalHeads: input.withGrants
      ? [
          {
            principalType: "group",
            principalId: "readers",
            version: 2,
            keyEpoch: 1,
            stateHash: await fixtureHash("readers-policy"),
            keyFingerprint: await fixtureHash("readers-key"),
          },
        ]
      : [],
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
  return { result, state, previous };
}

test("recitation preserves non-empty direct grants and exact principal pins", async () => {
  const { result, previous } = await recite({ withGrants: true });
  if (!result.ok) throw result.error;
  expect(previous.state.directGrants).toHaveLength(2);
  expect(previous.state.referencedPrincipalHeads).toHaveLength(1);
  expect(result.value.state.directGrants).toEqual(previous.state.directGrants);
  expect(result.value.manifest.grantRoot).toBe(previous.manifest.grantRoot);
  expect(result.value.state.referencedPrincipalHeads).toEqual(
    previous.state.referencedPrincipalHeads,
  );
  expect(result.value.state.parentContainerId).toBe(
    previous.state.parentContainerId,
  );
  expect(result.value.state.parentManifestHash).toBe(
    previous.state.parentManifestHash,
  );
  expect(result.value.state.containerKeyEpochId).toBe(
    previous.state.containerKeyEpochId,
  );
});

test("recitation advances the access head without changing an empty child's grants or keys", async () => {
  const { result, state } = await recite();
  if (!result.ok) throw result.error;
  expect(result.value.state).toEqual(state);
  expect(result.value.state.directGrants).toEqual([]);
  expect(result.value.state.containerKeyEpochId).toBe("child-key");
});

test("recitation requires admin access through its authorization path", async () => {
  for (const signerUserId of ["stranger", "writer"]) {
    const { result } = await recite({ signerUserId });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
  }
});

test("recitation reserves the remaining verifier history budget for ordinary mutations", async () => {
  const accepted = await recite({
    previousEpoch: MAX_CONTAINER_RECITATION_EPOCH - 1,
  });
  expect(accepted.result.ok).toBe(true);
  const refused = await recite({
    previousEpoch: MAX_CONTAINER_RECITATION_EPOCH,
  });
  expect(refused.result).toMatchObject({
    ok: false,
    error: { code: "invalid_shape" },
  });
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
