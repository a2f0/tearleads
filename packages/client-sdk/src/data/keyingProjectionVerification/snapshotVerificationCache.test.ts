import { expect, spyOn, test } from "bun:test";
import * as crypto from "@tearleads/crypto";
import {
  createOrganizationHistoryFixture,
  policySnapshot,
} from "../../../test/helpers/organizationPolicyHistory";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { verifyReceivedPolicySnapshot } from "./snapshotVerificationCache";

test("reused proof bytes skip signatures while changed bytes and trusted keys still fail", async () => {
  const data = await createOrganizationHistoryFixture();
  const input = {
    snapshot: policySnapshot(data.afterAddition),
    expectedReference: principalPolicyHead(data.afterAddition),
    signerPublicKeys: [
      {
        userId: data.signerUserId,
        signingKeyFingerprint:
          data.initial.currentState.signerUserKeyFingerprint,
        signingPublicKey: data.signingKeyPair.signingPublicKey,
      },
    ],
  };
  const verify = spyOn(crypto, "verifyPrincipalPolicySnapshot");
  try {
    const first = await verifyReceivedPolicySnapshot(input);
    expect(first.ok).toBe(true);
    if (!first.ok) throw first.error;
    const version = first.value.version;
    Reflect.set(first.value, "version", -1); // Callers cannot corrupt the memo.
    for (let index = 0; index < 16; index += 1) {
      const next = await verifyReceivedPolicySnapshot(input);
      expect(next.ok && next.value.version).toBe(version);
    }
    expect(verify).toHaveBeenCalledTimes(1);
    const grants = input.snapshot.currentGrants;
    input.snapshot.currentGrants = [
      { containerId: "injected", accessLevel: "admin" },
    ];
    expect((await verifyReceivedPolicySnapshot(input)).ok).toBe(false);
    input.snapshot.currentGrants = grants;
    const signer = input.signerPublicKeys[0];
    if (!signer) throw new Error("Missing signer");
    signer.signingPublicKey =
      crypto.generateSigningSeedAndKeyPair().signingPublicKey;
    expect((await verifyReceivedPolicySnapshot(input)).ok).toBe(false);
    expect(verify).toHaveBeenCalledTimes(3);
  } finally {
    verify.mockRestore();
  }
});
