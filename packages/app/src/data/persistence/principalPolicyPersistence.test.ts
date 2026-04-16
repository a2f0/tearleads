import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { createTestExecSql } from "../../../test/helpers/createTestExecSql";
import {
  ensurePrincipalPolicyTables,
  loadAllPrincipalPolicyBundles,
  loadPrincipalPolicyBundle,
  loadPrincipalPolicyStateHash,
  savePrincipalPolicyBundle,
} from "./principalPolicyPersistence";

async function createPrincipalPolicyBundle() {
  const principalKem = generateKemSeedAndKeyPair();
  const { signingPrivateKey } = generateSigningSeedAndKeyPair();
  const signedState = await signPrincipalState(
    {
      principalType: "group",
      principalId: "group-1",
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: await toFingerprint(principalKem.publicKey),
      members: [
        {
          principalType: "user",
          principalId: "alice",
        },
      ],
      signedAt: "2026-04-08T00:00:00.000Z",
      signerKeyId: "signer-1",
    },
    signingPrivateKey,
  );
  const stateHash = await computePrincipalStateHash(signedState);
  const bundle: PrincipalPolicyBundleResponse = {
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: "group-1",
      stateHash,
      epoch: 1,
      envelopes: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: "alice",
          memberKeyFingerprint: "member-key-1",
          kemCipherText: "kem-cipher-text-1",
          wrappedKey: "wrapped-key-1",
        },
      ],
    },
    currentState: {
      ...signedState,
      createdAt: "2026-04-08T00:00:00.000Z",
      stateHash,
    },
  };

  return {
    bundle,
    stateHash,
  };
}

test("principal policy persistence stores and reloads the current verified bundle", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-persistence-test",
  );

  try {
    const { bundle, stateHash } = await createPrincipalPolicyBundle();

    await ensurePrincipalPolicyTables(execSql);
    await savePrincipalPolicyBundle(
      execSql,
      bundle,
      "2026-04-08T00:01:00.000Z",
    );

    await expect(
      loadPrincipalPolicyStateHash(execSql, "group", "group-1"),
    ).resolves.toBe(stateHash);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("principal policy persistence reads from a fresh database before any bundle is cached", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-persistence-test",
  );

  try {
    await expect(loadAllPrincipalPolicyBundles(execSql)).resolves.toEqual([]);
    await expect(
      loadPrincipalPolicyStateHash(execSql, "group", "missing-group"),
    ).resolves.toBeNull();
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "missing-group"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
