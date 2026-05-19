import { expect, test } from "bun:test";
import {
  ensurePrincipalPolicyTables,
  loadAllPrincipalPolicyBundles,
  loadPrincipalPolicyBundle,
  loadPrincipalPolicyStateHash,
  savePrincipalPolicyBundle,
} from "@tearleads/client-sdk/data/persistence/principalPolicyPersistence";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { createTestExecSql } from "../../../test/helpers/createTestExecSql";

async function createPrincipalPolicyBundle() {
  const principalKem = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signerUserId = "signer-user-1";
  const signerUserKeyFingerprint = await toFingerprint(signingPublicKey);
  const currentProjection = [
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: signerUserId,
      role: "admin" as const,
    },
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: "alice",
      role: "member" as const,
    },
  ];
  const payloadCiphertext = "ciphertext-1";
  const signedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
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
      projection: currentProjection,
      payloadCiphertext,
      signedAt: "2026-04-08T00:00:00.000Z",
      signerUserId,
      signerUserKeyFingerprint,
    }),
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
    currentProjection,
    currentPayload: {
      principalType: "group",
      principalId: "group-1",
      stateHash,
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: signedState.payloadCiphertextHash,
      createdAt: "2026-04-08T00:00:00.000Z",
    },
    previousStates: [],
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
