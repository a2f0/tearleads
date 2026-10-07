import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import * as crypto from "@tearleads/crypto";
import { createSignedPrincipalState } from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { loadProjectionPolicyEvidence } from "./projectionPolicyEvidence";
import {
  clearStoredPolicySnapshotCache,
  verifyStoredPolicySnapshot,
} from "./snapshotVerificationCache";

test("stored snapshot memo binds the actual bytes, reference, and signer keys", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const bundle = await createSignedPrincipalState({
    principalType: "group",
    principalId: globalThis.crypto.randomUUID(),
    members: [],
    signerUserId: owner.userId,
    signerUserKeyFingerprint: owner.fingerprint,
    signingPrivateKey: owner.signing.signingPrivateKey,
  });
  const state = {
    ...bundle.state,
    stateHash: await crypto.computePrincipalStateHash(bundle.state),
  };
  const input = {
    expectedReference: state,
    snapshot: {
      currentState: state,
      currentProjection: bundle.projection,
      currentGrants: bundle.grants,
      previousStates: [],
    },
    signerPublicKeys: [
      {
        userId: owner.userId,
        signingKeyFingerprint: owner.fingerprint,
        signingPublicKey: owner.signing.signingPublicKey,
      },
    ],
  };
  const verify = spyOn(crypto, "verifyPrincipalPolicySnapshot");
  try {
    const first = await verifyStoredPolicySnapshot(input);
    expect(first.ok).toBe(true);
    if (!first.ok) throw first.error;
    expect(Object.getOwnPropertySymbols(first.value)).toHaveLength(1);
    expect(Object.isFrozen(first.value.history)).toBe(true);
    Reflect.set(first.value, "version", -1);
    const second = await verifyStoredPolicySnapshot(structuredClone(input));
    expect(second.ok && second.value.version).toBe(1);
    expect(verify).toHaveBeenCalledTimes(1);
    input.snapshot.currentProjection = [];
    expect((await verifyStoredPolicySnapshot(input)).ok).toBe(false);
    input.snapshot.currentProjection = bundle.projection;
    const signer = input.signerPublicKeys[0];
    if (!signer) throw new Error("Missing signer");
    signer.signingPublicKey =
      crypto.generateSigningSeedAndKeyPair().signingPublicKey;
    expect((await verifyStoredPolicySnapshot(input)).ok).toBe(false);
    expect(verify).toHaveBeenCalledTimes(3);
    signer.signingPublicKey = owner.signing.signingPublicKey;
    clearStoredPolicySnapshotCache();
    expect((await verifyStoredPolicySnapshot(input)).ok).toBe(true);
    expect(verify).toHaveBeenCalledTimes(4);
  } finally {
    verify.mockRestore();
  }
});

test("a projection without principal citations needs no organization history", async () => {
  expect(
    await loadProjectionPolicyEvidence({
      executor: db,
      scope: {
        organizationId: globalThis.crypto.randomUUID(),
        objectKind: "container",
        objectId: globalThis.crypto.randomUUID(),
        userId: globalThis.crypto.randomUUID(),
      },
      bundles: [],
    }),
  ).toEqual({ organization: null, organizationPayloads: [], groups: [] });
});
