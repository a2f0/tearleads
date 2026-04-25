import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  computePrincipalStatePayloadCiphertextHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { createTestExecSql } from "../../test/helpers/createTestExecSql";
import {
  ensurePrincipalPolicyTables,
  loadPrincipalPolicyBundle,
  loadPrincipalPolicyStateHash,
} from "./persistence/principalPolicyPersistence";
import { cacheReferencedPrincipalPolicies } from "./principalPolicySync";

async function createPrincipalPolicyBundle(): Promise<{
  bundle: PrincipalPolicyBundleResponse;
  signerKeyResponse: {
    userId: string;
    signingPublicKey: string;
    signingKeyFingerprint: string;
    encapsulationPublicKey: string;
  };
}> {
  const principalKem = generateKemSeedAndKeyPair();
  const principalKeyFingerprint = await toFingerprint(principalKem.publicKey);
  const signerUserId = "signer-user-1";
  const { signingPublicKey: signerPublicKey, signingPrivateKey } =
    generateSigningSeedAndKeyPair();
  const signerUserKeyFingerprint = await toFingerprint(signerPublicKey);
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
  const signedState = await signPrincipalState(
    {
      principalType: "group",
      principalId: "group-1",
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: principalKeyFingerprint,
      members: [
        {
          principalType: "user",
          principalId: "alice",
        },
      ],
      projection: currentProjection,
      payloadCiphertext: "ciphertext-1",
      signedAt: "2026-04-08T00:00:00.000Z",
      signerUserId,
      signerUserKeyFingerprint,
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
    currentProjection,
    currentPayload: {
      principalType: "group",
      principalId: "group-1",
      stateHash,
      cipherSuite: "aes-256-gcm-v1",
      ciphertext: signedState.payloadCiphertext ?? "ciphertext-1",
      ciphertextHash: await computePrincipalStatePayloadCiphertextHash(
        signedState.payloadCiphertext ?? "ciphertext-1",
      ),
      createdAt: "2026-04-08T00:00:00.000Z",
    },
    previousStates: [],
  };

  return {
    bundle,
    signerKeyResponse: {
      userId: signerUserId,
      signingPublicKey: bytesToBase64(signerPublicKey),
      signingKeyFingerprint: signerUserKeyFingerprint,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    },
  };
}

async function createSuccessorPrincipalPolicyBundle(): Promise<{
  bundle: PrincipalPolicyBundleResponse;
  signerKeyResponse: {
    userId: string;
    signingPublicKey: string;
    signingKeyFingerprint: string;
    encapsulationPublicKey: string;
  };
}> {
  const principalKem = generateKemSeedAndKeyPair();
  const principalKeyFingerprint = await toFingerprint(principalKem.publicKey);
  const signerUserId = "signer-user-1";
  const { signingPublicKey: signerPublicKey, signingPrivateKey } =
    generateSigningSeedAndKeyPair();
  const signerUserKeyFingerprint = await toFingerprint(signerPublicKey);
  const previousProjection = [
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
  const previousSignedState = await signPrincipalState(
    {
      principalType: "group",
      principalId: "group-1",
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: principalKeyFingerprint,
      members: [{ principalType: "user", principalId: "alice" }],
      projection: previousProjection,
      payloadCiphertext: "ciphertext-1",
      signedAt: "2026-04-08T00:00:00.000Z",
      signerUserId,
      signerUserKeyFingerprint,
    },
    signingPrivateKey,
  );
  const previousStateHash =
    await computePrincipalStateHash(previousSignedState);
  const currentProjection = [
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: signerUserId,
      role: "admin" as const,
    },
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: "bob",
      role: "member" as const,
    },
  ];
  const currentSignedState = await signPrincipalState(
    {
      principalType: "group",
      principalId: "group-1",
      version: 2,
      prevStateHash: previousStateHash,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: principalKeyFingerprint,
      members: [{ principalType: "user", principalId: "bob" }],
      projection: currentProjection,
      payloadCiphertext: "ciphertext-2",
      signedAt: "2026-04-08T00:01:00.000Z",
      signerUserId,
      signerUserKeyFingerprint,
    },
    signingPrivateKey,
  );
  const currentStateHash = await computePrincipalStateHash(currentSignedState);

  return {
    bundle: {
      currentMemberEnvelopes: {
        principalType: "group",
        principalId: "group-1",
        stateHash: currentStateHash,
        epoch: 1,
        envelopes: [],
      },
      currentState: {
        ...currentSignedState,
        createdAt: "2026-04-08T00:01:00.000Z",
        stateHash: currentStateHash,
      },
      currentProjection,
      currentPayload: {
        principalType: "group",
        principalId: "group-1",
        stateHash: currentStateHash,
        cipherSuite: "aes-256-gcm-v1",
        ciphertext: currentSignedState.payloadCiphertext ?? "ciphertext-2",
        ciphertextHash: await computePrincipalStatePayloadCiphertextHash(
          currentSignedState.payloadCiphertext ?? "ciphertext-2",
        ),
        createdAt: "2026-04-08T00:01:00.000Z",
      },
      previousStates: [
        {
          state: {
            ...previousSignedState,
            createdAt: "2026-04-08T00:00:00.000Z",
            stateHash: previousStateHash,
          },
          projection: previousProjection,
        },
      ],
    },
    signerKeyResponse: {
      userId: signerUserId,
      signingPublicKey: bytesToBase64(signerPublicKey),
      signingKeyFingerprint: signerUserKeyFingerprint,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    },
  };
}

test("principal policy sync caches a verified referenced principal bundle and skips refetching unchanged state", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    let getCurrentPrincipalPolicyCallCount = 0;

    await cacheReferencedPrincipalPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => {
        getCurrentPrincipalPolicyCallCount += 1;
        return bundle;
      },
      getEncapsulationKey: async () => signerKeyResponse,
      references: [
        {
          principalType: "group",
          principalId: "group-1",
          version: bundle.currentState.version,
          keyEpoch: bundle.currentState.keyEpoch,
          stateHash: bundle.currentState.stateHash,
        },
      ],
    });

    await expect(
      loadPrincipalPolicyStateHash(execSql, "group", "group-1"),
    ).resolves.toBe(bundle.currentState.stateHash);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);

    await cacheReferencedPrincipalPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => {
        getCurrentPrincipalPolicyCallCount += 1;
        return bundle;
      },
      getEncapsulationKey: async () => signerKeyResponse,
      references: [
        {
          principalType: "group",
          principalId: "group-1",
          version: bundle.currentState.version,
          keyEpoch: bundle.currentState.keyEpoch,
          stateHash: bundle.currentState.stateHash,
        },
      ],
    });

    expect(getCurrentPrincipalPolicyCallCount).toBe(1);
  } finally {
    close();
  }
});

test("principal policy sync verifies successor state from the fetched chain when no previous bundle is cached", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    const logs: string[] = [];

    await cacheReferencedPrincipalPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getEncapsulationKey: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [
        {
          principalType: "group",
          principalId: "group-1",
          version: bundle.currentState.version,
          keyEpoch: bundle.currentState.keyEpoch,
          stateHash: bundle.currentState.stateHash,
        },
      ],
    });

    expect(logs).toEqual([]);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("principal policy sync skips bundles when the signer key does not match", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);

    await cacheReferencedPrincipalPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getEncapsulationKey: async () => ({
        ...signerKeyResponse,
        signingKeyFingerprint: "mismatched-fingerprint",
      }),
      references: [
        {
          principalType: "group",
          principalId: "group-1",
          version: bundle.currentState.version,
          keyEpoch: bundle.currentState.keyEpoch,
          stateHash: bundle.currentState.stateHash,
        },
      ],
    });

    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
