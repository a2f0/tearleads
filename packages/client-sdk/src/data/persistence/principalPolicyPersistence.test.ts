import { expect, test } from "bun:test";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  makeVerifiedPrincipalPolicy,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { advanceKeyingCheckpointsAtomically } from "./keyingCheckpointAdvancePersistence";
import {
  ensurePrincipalPolicyTables,
  loadAllPrincipalPolicyBundles,
  loadPrincipalPolicyBundle,
  loadPrincipalPolicyStateHash,
  retainVerifiedPrincipalPolicyBundle,
  savePrincipalPolicyBundle,
} from "./principalPolicyPersistence";

async function createPrincipalPolicyBundle() {
  const principalKem = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signerUserId = "signer-user-1";
  const signerUserKeyFingerprint = await toFingerprint(signingPublicKey);
  const currentProjection = [
    {
      userId: signerUserId,
      role: "admin" as const,
    },
    {
      userId: "alice",
      role: "member" as const,
    },
  ];
  const payloadCiphertext = "ciphertext-1";
  const signerKem = generateKemSeedAndKeyPair();
  const aliceKem = generateKemSeedAndKeyPair();
  const recipientIds = [signerUserId, "alice"];
  const wrappedRecipients = await wrapDekForRecipients(principalKem.secretKey, [
    signerKem.publicKey,
    aliceKem.publicKey,
  ]);
  const memberEnvelopes = wrappedRecipients.map((envelope, index) => ({
    userId: recipientIds[index] ?? "",
    memberKeyFingerprint: envelope.keyFingerprint,
    kemCipherText: bytesToBase64(envelope.kemCipherText),
    wrappedKey: bytesToBase64(envelope.wrappedKey),
  }));
  const signedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: "group-1",
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
      keyFingerprint: await toFingerprint(principalKem.publicKey),
      members: currentProjection.map((member) => ({
        userId: member.userId,
      })),
      memberEnvelopes,
      projection: currentProjection,
      grants: [],
      payloadCiphertext,
      externalAuthority: null,
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
      envelopes: memberEnvelopes,
    },
    currentState: {
      ...signedState,
      createdAt: "2026-04-08T00:00:00.000Z",
      stateHash,
    },
    currentProjection,
    currentGrants: [],
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

function successorBundleForPersistence(
  bundle: PrincipalPolicyBundleResponse,
  stateHashDigit = "2",
): PrincipalPolicyBundleResponse {
  const stateHash = stateHashDigit.repeat(64);
  return {
    ...bundle,
    currentState: {
      ...bundle.currentState,
      version: bundle.currentState.version + 1,
      keyEpoch: bundle.currentState.keyEpoch + 1,
      prevStateHash: bundle.currentState.stateHash,
      stateHash,
    },
    currentPayload: { ...bundle.currentPayload, stateHash },
    currentMemberEnvelopes: {
      ...bundle.currentMemberEnvelopes,
      epoch: bundle.currentState.keyEpoch + 1,
      stateHash,
    },
    previousStates: [
      ...bundle.previousStates,
      {
        state: bundle.currentState,
        projection: bundle.currentProjection,
        grants: bundle.currentGrants,
      },
    ],
  };
}

function verifiedPolicyForPersistence(bundle: PrincipalPolicyBundleResponse) {
  return makeVerifiedPrincipalPolicy({
    checkpoint: {
      principalId: bundle.currentState.principalId,
      principalType: bundle.currentState.principalType,
      stateHash: bundle.currentState.stateHash,
      version: bundle.currentState.version,
    },
    history: [
      ...bundle.previousStates,
      {
        state: bundle.currentState,
        projection: bundle.currentProjection,
        grants: bundle.currentGrants,
      },
    ],
    keyEpoch: bundle.currentState.keyEpoch,
    principalId: bundle.currentState.principalId,
    principalType: bundle.currentState.principalType,
    projection: bundle.currentProjection,
    grants: bundle.currentGrants,
    state: bundle.currentState,
    stateHash: bundle.currentState.stateHash,
    version: bundle.currentState.version,
  });
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

test("principal policy persistence rejects a competing head at the cached version", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-persistence-head-conflict",
  );

  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const competingStateHash = "f".repeat(64);
    const competingBundle: PrincipalPolicyBundleResponse = {
      ...bundle,
      currentState: {
        ...bundle.currentState,
        stateHash: competingStateHash,
      },
      currentPayload: {
        ...bundle.currentPayload,
        stateHash: competingStateHash,
      },
      currentMemberEnvelopes: {
        ...bundle.currentMemberEnvelopes,
        stateHash: competingStateHash,
      },
    };
    await savePrincipalPolicyBundle(
      execSql,
      bundle,
      "2026-04-08T00:01:00.000Z",
    );

    await expect(
      savePrincipalPolicyBundle(
        execSql,
        competingBundle,
        "2026-04-08T00:02:00.000Z",
      ),
    ).rejects.toMatchObject({
      code: "equivocation",
      name: "KeyingVerificationError",
    });
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(bundle);
  } finally {
    close();
  }
});

test("principal policy persistence rejects a stored-head fork below a newer checkpoint", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-persistence-conflict-below-checkpoint",
  );

  try {
    const { bundle: version1 } = await createPrincipalPolicyBundle();
    const storedVersion2 = successorBundleForPersistence(version1);
    const competingVersion2 = successorBundleForPersistence(version1, "4");
    const checkpointVersion3 = successorBundleForPersistence(
      storedVersion2,
      "3",
    );
    await savePrincipalPolicyBundle(
      execSql,
      storedVersion2,
      "2026-04-08T00:01:00.000Z",
    );
    await advanceKeyingCheckpointsAtomically({
      access: [],
      execSql,
      policies: [
        verifiedPolicyForPersistence(storedVersion2),
        verifiedPolicyForPersistence(checkpointVersion3),
      ],
    });

    await expect(
      savePrincipalPolicyBundle(
        execSql,
        competingVersion2,
        "2026-04-08T00:02:00.000Z",
      ),
    ).rejects.toMatchObject({
      code: "equivocation",
      name: "KeyingVerificationError",
    });
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(storedVersion2);
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

test("principal policy persistence retains old epoch material without allowing cache regression", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-persistence-history",
  );

  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const successor = successorBundleForPersistence(bundle);
    await savePrincipalPolicyBundle(
      execSql,
      bundle,
      "2026-04-08T00:01:00.000Z",
    );
    await savePrincipalPolicyBundle(
      execSql,
      successor,
      "2026-04-08T00:02:00.000Z",
    );
    await savePrincipalPolicyBundle(
      execSql,
      bundle,
      "2026-04-08T00:03:00.000Z",
    );

    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(successor);
    const bundles = await loadAllPrincipalPolicyBundles(execSql);
    expect(bundles.map((entry) => entry.currentState.stateHash).sort()).toEqual(
      [bundle.currentState.stateHash, successor.currentState.stateHash].sort(),
    );
  } finally {
    close();
  }
});

test.each([
  "save-v2-before-v3",
  "save-v3-before-v2",
])("verified policy retention survives an overtaking checkpoint: %s", async (ordering) => {
  const { close, execSql } = await createTestExecSql(
    `principal-policy-retention-${ordering}`,
  );

  try {
    const { bundle: version1 } = await createPrincipalPolicyBundle();
    const version2 = successorBundleForPersistence(version1);
    const version3 = successorBundleForPersistence(version2, "3");
    const verified2 = verifiedPolicyForPersistence(version2);
    const verified3 = verifiedPolicyForPersistence(version3);
    await savePrincipalPolicyBundle(execSql, version1, "2026-04-08T00:01:00Z");
    await retainVerifiedPrincipalPolicyBundle({
      bundle: version2,
      execSql,
      policy: verified2,
      updatedAt: "2026-04-08T00:02:00Z",
    });
    await advanceKeyingCheckpointsAtomically({
      access: [],
      execSql,
      policies: [verified2, verified3],
    });

    if (ordering === "save-v2-before-v3") {
      await savePrincipalPolicyBundle(
        execSql,
        version2,
        "2026-04-08T00:03:00Z",
      );
    }
    await savePrincipalPolicyBundle(execSql, version3, "2026-04-08T00:04:00Z");
    if (ordering === "save-v3-before-v2") {
      await savePrincipalPolicyBundle(
        execSql,
        version2,
        "2026-04-08T00:05:00Z",
      );
    }

    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toEqual(version3);
    const stateHashes = (await loadAllPrincipalPolicyBundles(execSql)).map(
      (entry) => entry.currentState.stateHash,
    );
    expect([...new Set(stateHashes)].sort()).toEqual(
      [version1, version2, version3]
        .map((entry) => entry.currentState.stateHash)
        .sort(),
    );
    expect(stateHashes).toHaveLength(3);
  } finally {
    close();
  }
});

test("verified policy retention rejects a mismatched proof", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-retention-mismatch",
  );
  try {
    const { bundle: version1 } = await createPrincipalPolicyBundle();
    const version2 = successorBundleForPersistence(version1);
    const differentVersion2 = successorBundleForPersistence(version1, "4");

    await expect(
      retainVerifiedPrincipalPolicyBundle({
        bundle: version2,
        execSql,
        policy: verifiedPolicyForPersistence(differentVersion2),
        updatedAt: "2026-04-08T00:02:00Z",
      }),
    ).rejects.toThrow("head mismatch");
    await expect(loadAllPrincipalPolicyBundles(execSql)).resolves.toEqual([]);
  } finally {
    close();
  }
});
