import { expect, test } from "bun:test";
import {
  buildInitialGroupPolicyRequest,
  buildInitialOrganizationPolicyRequest,
  type CacheReferencedPrincipalPoliciesOptions,
  cacheReferencedPrincipalPolicies,
} from "@tearleads/client-sdk";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  EncapsulationKeyResponse,
  PrincipalPolicyBundleResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import {
  ensurePrincipalPolicyTables,
  loadPrincipalPolicyBundle,
  loadPrincipalPolicyStateHash,
  savePrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";

function cacheReferencedPolicies(
  options: CacheReferencedPrincipalPoliciesOptions,
): Promise<void> {
  return cacheReferencedPrincipalPolicies(options);
}

type InitialPrincipalPolicy =
  | Awaited<
      ReturnType<typeof buildInitialGroupPolicyRequest>
    >["initialGroupPolicy"]
  | Awaited<ReturnType<typeof buildInitialOrganizationPolicyRequest>>;

async function principalPolicyBundleFromInitialPolicy(input: {
  readonly principalId: string;
  readonly policy: InitialPrincipalPolicy;
}): Promise<PrincipalPolicyBundleResponse> {
  const stateHash = await computePrincipalStateHash(input.policy.state);

  return {
    currentState: {
      ...input.policy.state,
      createdAt: "2026-04-08T00:00:00.000Z",
      stateHash,
    },
    currentPayload: {
      principalType: input.policy.state.principalType,
      principalId: input.principalId,
      stateHash,
      cipherSuite: input.policy.encryptedPayload.cipherSuite,
      ciphertext: input.policy.encryptedPayload.ciphertext,
      ciphertextHash: input.policy.encryptedPayload.ciphertextHash,
      createdAt: "2026-04-08T00:00:00.000Z",
    },
    currentProjection: input.policy.projection,
    currentMemberEnvelopes: {
      principalType: input.policy.state.principalType,
      principalId: input.principalId,
      stateHash,
      epoch: input.policy.state.keyEpoch,
      envelopes: input.policy.memberEnvelopes,
    },
    previousStates: [],
  };
}

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
      cipherSuite: "aes-256-gcm",
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
        cipherSuite: "aes-256-gcm",
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
        cipherSuite: "aes-256-gcm",
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

function referencedPrincipalStateFromBundle(
  bundle: PrincipalPolicyBundleResponse,
): ReferencedPrincipalStateResponse {
  return referencedPrincipalStateFromPolicyState(bundle.currentState);
}

function referencedPrincipalStateFromPolicyState(
  state: PrincipalPolicyBundleResponse["currentState"],
): ReferencedPrincipalStateResponse {
  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
    keyFingerprint: state.keyFingerprint,
  };
}

test("principal policy sync caches a verified referenced principal bundle and skips refetching unchanged state", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } = await createPrincipalPolicyBundle();
    let getCurrentPrincipalPolicyCallCount = 0;

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => {
        getCurrentPrincipalPolicyCallCount += 1;
        return bundle;
      },
      getEncapsulationKey: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    await expect(
      loadPrincipalPolicyStateHash(execSql, "group", "group-1"),
    ).resolves.toBe(bundle.currentState.stateHash);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => {
        getCurrentPrincipalPolicyCallCount += 1;
        return bundle;
      },
      getEncapsulationKey: async () => signerKeyResponse,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(getCurrentPrincipalPolicyCallCount).toBe(1);
  } finally {
    close();
  }
});

test("principal policy sync authorizes empty group bundles from verified organization admins", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const organizationId = "organization-1";
    const groupId = "group-empty-1";
    const signerUserId = "organization-admin-1";
    const signingKeyPair = generateSigningSeedAndKeyPair();
    const encapsulationKeyPair = generateKemSeedAndKeyPair();
    const signingKeyFingerprint = await toFingerprint(
      signingKeyPair.signingPublicKey,
    );
    const signerKeyResponse = {
      userId: signerUserId,
      signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
      signingKeyFingerprint,
      encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
    };
    const organizationPolicy = await principalPolicyBundleFromInitialPolicy({
      principalId: organizationId,
      policy: await buildInitialOrganizationPolicyRequest({
        encapsulationPublicKey: encapsulationKeyPair.publicKey,
        organizationId,
        signingKeyPair,
        userId: signerUserId,
      }),
    });
    const groupPolicy = await principalPolicyBundleFromInitialPolicy({
      principalId: groupId,
      policy: (
        await buildInitialGroupPolicyRequest({
          creatorEncapsulationKeyPair: encapsulationKeyPair,
          groupId,
          includeSignerAsAdmin: false,
          name: "Operators",
          signerUserId,
          signingFingerprint: signingKeyFingerprint,
          signingKeyPair,
        })
      ).initialGroupPolicy,
    });
    const logs: string[] = [];

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        if (
          principalType === "organization" &&
          principalId === organizationId
        ) {
          return organizationPolicy;
        }

        expect(principalType).toBe("group");
        expect(principalId).toBe(groupId);
        return groupPolicy;
      },
      getEncapsulationKey: async (userId) => {
        expect(userId).toBe(signerUserId);
        return signerKeyResponse;
      },
      log: (message) => logs.push(message),
      organizationId,
      references: [referencedPrincipalStateFromBundle(groupPolicy)],
    });

    expect(logs).toEqual([]);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", groupId),
    ).resolves.toEqual(groupPolicy);
    await expect(
      loadPrincipalPolicyBundle(execSql, "organization", organizationId),
    ).resolves.toEqual(organizationPolicy);
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

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getEncapsulationKey: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(logs).toEqual([]);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("principal policy sync caches current state when the reference points at a historical head", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerKeyResponse } =
      await createSuccessorPrincipalPolicyBundle();
    const previousState = bundle.previousStates[0]?.state;
    if (!previousState) {
      throw new Error("expected previous principal policy state");
    }
    const logs: string[] = [];

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getEncapsulationKey: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromPolicyState(previousState)],
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

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getEncapsulationKey: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromBundle(bundle)],
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

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => olderBundle,
      getEncapsulationKey: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromBundle(olderBundle)],
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

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => conflictingBundle,
      getEncapsulationKey: async () => null,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromBundle(conflictingBundle)],
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

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => tamperedBundle,
      getEncapsulationKey: async () => signerKeyResponse,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(logs).toContain(
      "Principal policy cache: skipped group:group-1: principal policy projection root does not match projection",
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

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getEncapsulationKey: async (userId) =>
        signerKeyResponses.get(userId) ?? null,
      log: (message) => logs.push(message),
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(logs).toContain(
      "Principal policy cache: skipped group:group-1: principal policy state signer is not an admin in previous projection",
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

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      getEncapsulationKey: async () => ({
        ...signerKeyResponse,
        signingKeyFingerprint: "mismatched-fingerprint",
      }),
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
