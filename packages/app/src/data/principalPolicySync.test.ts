import { expect, test } from "bun:test";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  EncapsulationKeyResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { createTestExecSql } from "../../test/helpers/createTestExecSql";
import {
  ensurePrincipalPolicyTables,
  loadPrincipalPolicyBundle,
  loadPrincipalPolicyStateHash,
  savePrincipalPolicyBundle,
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
  const payloadCiphertext = "ciphertext-1";
  const signedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
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
      cipherSuite: "aes-256-gcm-v1",
      ciphertext: payloadCiphertext,
      ciphertextHash: signedState.payloadCiphertextHash,
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

async function createSuccessorPrincipalPolicyBundle(
  options: { shrinkWithoutRotation?: boolean } = {},
): Promise<{
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
  const previousPayloadCiphertext = "ciphertext-1";
  const previousSignedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: "group-1",
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: principalKeyFingerprint,
      members: [{ principalType: "user", principalId: "alice" }],
      projection: previousProjection,
      payloadCiphertext: previousPayloadCiphertext,
      signedAt: "2026-04-08T00:00:00.000Z",
      signerUserId,
      signerUserKeyFingerprint,
    }),
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
    ...(options.shrinkWithoutRotation
      ? []
      : [
          {
            memberPrincipalType: "user" as const,
            memberPrincipalId: "alice",
            role: "member" as const,
          },
        ]),
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: "bob",
      role: "member" as const,
    },
  ];
  const currentPayloadCiphertext = "ciphertext-2";
  const currentSignedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: "group-1",
      version: 2,
      prevStateHash: previousStateHash,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: principalKeyFingerprint,
      members: [
        ...(options.shrinkWithoutRotation
          ? []
          : [{ principalType: "user" as const, principalId: "alice" }]),
        { principalType: "user", principalId: "bob" },
      ],
      projection: currentProjection,
      payloadCiphertext: currentPayloadCiphertext,
      signedAt: "2026-04-08T00:01:00.000Z",
      signerUserId,
      signerUserKeyFingerprint,
    }),
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
        ciphertext: currentPayloadCiphertext,
        ciphertextHash: currentSignedState.payloadCiphertextHash,
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

async function createUnauthorizedSuccessorPrincipalPolicyBundle(): Promise<{
  bundle: PrincipalPolicyBundleResponse;
  signerKeyResponses: Map<string, EncapsulationKeyResponse>;
}> {
  const principalKem = generateKemSeedAndKeyPair();
  const principalKeyFingerprint = await toFingerprint(principalKem.publicKey);
  const adminUserId = "admin-user-1";
  const outsiderUserId = "outsider-user-1";
  const {
    signingPublicKey: adminSigningPublicKey,
    signingPrivateKey: adminSigningPrivateKey,
  } = generateSigningSeedAndKeyPair();
  const {
    signingPublicKey: outsiderSigningPublicKey,
    signingPrivateKey: outsiderSigningPrivateKey,
  } = generateSigningSeedAndKeyPair();
  const adminSigningKeyFingerprint = await toFingerprint(adminSigningPublicKey);
  const outsiderSigningKeyFingerprint = await toFingerprint(
    outsiderSigningPublicKey,
  );
  const previousProjection = [
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: adminUserId,
      role: "admin" as const,
    },
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: outsiderUserId,
      role: "member" as const,
    },
  ];
  const previousPayloadCiphertext = "ciphertext-1";
  const previousSignedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: "group-1",
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: principalKeyFingerprint,
      members: [{ principalType: "user", principalId: adminUserId }],
      projection: previousProjection,
      payloadCiphertext: previousPayloadCiphertext,
      signedAt: "2026-04-08T00:00:00.000Z",
      signerUserId: adminUserId,
      signerUserKeyFingerprint: adminSigningKeyFingerprint,
    }),
    adminSigningPrivateKey,
  );
  const previousStateHash =
    await computePrincipalStateHash(previousSignedState);
  const currentProjection = [
    {
      memberPrincipalType: "user" as const,
      memberPrincipalId: outsiderUserId,
      role: "admin" as const,
    },
  ];
  const currentPayloadCiphertext = "ciphertext-2";
  const currentSignedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: "group-1",
      version: 2,
      prevStateHash: previousStateHash,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: principalKeyFingerprint,
      members: [{ principalType: "user", principalId: outsiderUserId }],
      projection: currentProjection,
      payloadCiphertext: currentPayloadCiphertext,
      signedAt: "2026-04-08T00:01:00.000Z",
      signerUserId: outsiderUserId,
      signerUserKeyFingerprint: outsiderSigningKeyFingerprint,
    }),
    outsiderSigningPrivateKey,
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
        ciphertext: currentPayloadCiphertext,
        ciphertextHash: currentSignedState.payloadCiphertextHash,
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
    signerKeyResponses: new Map([
      [
        adminUserId,
        {
          userId: adminUserId,
          signingPublicKey: bytesToBase64(adminSigningPublicKey),
          signingKeyFingerprint: adminSigningKeyFingerprint,
          encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
        },
      ],
      [
        outsiderUserId,
        {
          userId: outsiderUserId,
          signingPublicKey: bytesToBase64(outsiderSigningPublicKey),
          signingKeyFingerprint: outsiderSigningKeyFingerprint,
          encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
        },
      ],
    ]),
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

test("principal policy sync skips shrinking successors that reuse the key epoch", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle({
        shrinkWithoutRotation: true,
      });
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

    expect(logs).toContain(
      "Principal policy cache: skipped group:group-1: Principal policy shrink requires a new key epoch and key material",
    );
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("principal policy sync skips rollbacks against the cached checkpoint", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle: cachedBundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    const { bundle: olderBundle } = await createPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);
    await savePrincipalPolicyBundle(
      execSql,
      cachedBundle,
      "2026-04-08T00:02:00.000Z",
    );
    const logs: string[] = [];

    await cacheReferencedPrincipalPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => olderBundle,
      getEncapsulationKey: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [
        {
          principalType: "group",
          principalId: "group-1",
          version: olderBundle.currentState.version,
          keyEpoch: olderBundle.currentState.keyEpoch,
          stateHash: olderBundle.currentState.stateHash,
        },
      ],
    });

    expect(logs).toContain(
      "Principal policy cache: skipped group:group-1: principal policy state is older than the local checkpoint",
    );
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(cachedBundle);
  } finally {
    close();
  }
});

test("principal policy sync skips same-version conflicts against the cached checkpoint", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle: cachedBundle } = await createPrincipalPolicyBundle();
    const { bundle: conflictingBundle } = await createPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);
    await savePrincipalPolicyBundle(
      execSql,
      cachedBundle,
      "2026-04-08T00:02:00.000Z",
    );
    const logs: string[] = [];

    await cacheReferencedPrincipalPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => conflictingBundle,
      getEncapsulationKey: async () => null,
      log: (message) => logs.push(message),
      references: [
        {
          principalType: "group",
          principalId: "group-1",
          version: conflictingBundle.currentState.version,
          keyEpoch: conflictingBundle.currentState.keyEpoch,
          stateHash: conflictingBundle.currentState.stateHash,
        },
      ],
    });

    expect(logs).toContain(
      "Principal policy cache: skipped group:group-1: principal policy state conflicts with the local checkpoint",
    );
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(cachedBundle);
  } finally {
    close();
  }
});

test("principal policy sync skips bundles whose projection does not match the signed root", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);
    const logs: string[] = [];
    const [firstProjectionMember, ...remainingProjection] =
      bundle.currentProjection;
    if (!firstProjectionMember) {
      throw new Error("expected principal policy projection member");
    }
    const tamperedBundle: PrincipalPolicyBundleResponse = {
      ...bundle,
      currentProjection: [
        {
          ...firstProjectionMember,
          role: firstProjectionMember.role === "admin" ? "member" : "admin",
        },
        ...remainingProjection,
      ],
    };

    await cacheReferencedPrincipalPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => tamperedBundle,
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

    expect(logs).toContain(
      "Principal policy cache: skipped group:group-1: computed projection root does not match chain entry state projection root",
    );
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("principal policy sync skips successor bundles signed by non-admins", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponses } =
      await createUnauthorizedSuccessorPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);
    const logs: string[] = [];

    await cacheReferencedPrincipalPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getEncapsulationKey: async (userId) =>
        signerKeyResponses.get(userId) ?? null,
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

    expect(logs).toContain(
      "Principal policy cache: skipped group:group-1: state signer is not an admin in previous projection",
    );
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
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
