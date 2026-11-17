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
import { createFixtureUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { KeyingCheckpointRepository } from "../keyingCheckpoints/keyingCheckpointRepository";
import { PrincipalPolicyBundleRepository } from "./principalPolicyBundleRepository";

async function createPrincipalPolicyBundle() {
  const principalKem = generateKemSeedAndKeyPair();
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const signerUserId = "signer-user-1";
  const signerUserKeyFingerprint = await toFingerprint(signingPublicKey);
  const signerKem = generateKemSeedAndKeyPair();
  const aliceKem = generateKemSeedAndKeyPair();
  const signer = await createFixtureUserIdentity({
    userId: signerUserId,
    signingPublicKey,
    encapsulationPublicKey: signerKem.publicKey,
  });
  const alice = await createFixtureUserIdentity({
    userId: "alice",
    encapsulationPublicKey: aliceKem.publicKey,
  });
  const currentProjection = [
    {
      userId: signerUserId,
      identityBundleFingerprint: signer.identityBundleFingerprint,
      role: "admin" as const,
    },
    {
      userId: "alice",
      identityBundleFingerprint: alice.identityBundleFingerprint,
      role: "member" as const,
    },
  ];
  const payloadCiphertext = "ciphertext-1";
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

    await new PrincipalPolicyBundleRepository(
      execSql,
    ).ensurePrincipalPolicyTables();
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).savePrincipalPolicyBundle(bundle, "org-1");

    await expect(
      new PrincipalPolicyBundleRepository(execSql).loadPrincipalPolicyStateHash(
        "group",
        "group-1",
      ),
    ).resolves.toBe(stateHash);
    await expect(
      new PrincipalPolicyBundleRepository(execSql).loadPrincipalPolicyBundle(
        "group",
        "group-1",
      ),
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
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).savePrincipalPolicyBundle(bundle, "org-1");

    await expect(
      new PrincipalPolicyBundleRepository(execSql).savePrincipalPolicyBundle(
        competingBundle,
        "org-1",
      ),
    ).rejects.toMatchObject({
      code: "equivocation",
      name: "KeyingVerificationError",
    });
    await expect(
      new PrincipalPolicyBundleRepository(execSql).loadPrincipalPolicyBundle(
        "group",
        "group-1",
      ),
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
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).savePrincipalPolicyBundle(storedVersion2, "org-1");
    await new KeyingCheckpointRepository(
      execSql,
    ).advanceKeyingCheckpointsAtomically({
      organizationId: "org-1",
      access: [],
      policies: [
        verifiedPolicyForPersistence(storedVersion2),
        verifiedPolicyForPersistence(checkpointVersion3),
      ],
    });

    await expect(
      new PrincipalPolicyBundleRepository(execSql).savePrincipalPolicyBundle(
        competingVersion2,
        "org-1",
      ),
    ).rejects.toMatchObject({
      code: "equivocation",
      name: "KeyingVerificationError",
    });
    await expect(
      new PrincipalPolicyBundleRepository(execSql).loadPrincipalPolicyBundle(
        "group",
        "group-1",
      ),
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
    await expect(
      new PrincipalPolicyBundleRepository(
        execSql,
      ).loadAllPrincipalPolicyBundles(),
    ).resolves.toEqual([]);
    await expect(
      new PrincipalPolicyBundleRepository(execSql).loadPrincipalPolicyStateHash(
        "group",
        "missing-group",
      ),
    ).resolves.toBeNull();
    await expect(
      new PrincipalPolicyBundleRepository(execSql).loadPrincipalPolicyBundle(
        "group",
        "missing-group",
      ),
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
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).savePrincipalPolicyBundle(bundle, "org-1");
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).savePrincipalPolicyBundle(successor, "org-1");
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).savePrincipalPolicyBundle(bundle, "org-1");

    await expect(
      new PrincipalPolicyBundleRepository(execSql).loadPrincipalPolicyBundle(
        "group",
        "group-1",
      ),
    ).resolves.toEqual(successor);
    const bundles = await new PrincipalPolicyBundleRepository(
      execSql,
    ).loadAllPrincipalPolicyBundles();
    expect(bundles.map((entry) => entry.currentState.stateHash).sort()).toEqual(
      [bundle.currentState.stateHash, successor.currentState.stateHash].sort(),
    );
  } finally {
    close();
  }
});

test.each(["save-v2-before-v3", "save-v3-before-v2"])(
  "verified policy retention survives an overtaking checkpoint: %s",
  async (ordering) => {
    const { close, execSql } = await createTestExecSql(
      `principal-policy-retention-${ordering}`,
    );

    try {
      const { bundle: version1 } = await createPrincipalPolicyBundle();
      const version2 = successorBundleForPersistence(version1);
      const version3 = successorBundleForPersistence(version2, "3");
      const verified2 = verifiedPolicyForPersistence(version2);
      const verified3 = verifiedPolicyForPersistence(version3);
      await new PrincipalPolicyBundleRepository(
        execSql,
      ).savePrincipalPolicyBundle(version1, "org-1");
      await new PrincipalPolicyBundleRepository(
        execSql,
      ).retainVerifiedPrincipalPolicyBundle({
        organizationId: "org-1",
        bundle: version2,
        policy: verified2,
        updatedAt: "2026-04-08T00:02:00Z",
      });
      await new KeyingCheckpointRepository(
        execSql,
      ).advanceKeyingCheckpointsAtomically({
        organizationId: "org-1",
        access: [],
        policies: [verified2, verified3],
      });

      if (ordering === "save-v2-before-v3") {
        await new PrincipalPolicyBundleRepository(
          execSql,
        ).savePrincipalPolicyBundle(version2, "org-1");
      }
      await new PrincipalPolicyBundleRepository(
        execSql,
      ).savePrincipalPolicyBundle(version3, "org-1");
      if (ordering === "save-v3-before-v2") {
        await new PrincipalPolicyBundleRepository(
          execSql,
        ).savePrincipalPolicyBundle(version2, "org-1");
      }

      await expect(
        new PrincipalPolicyBundleRepository(execSql).loadPrincipalPolicyBundle(
          "group",
          "group-1",
        ),
      ).resolves.toEqual(version3);
      const stateHashes = (
        await new PrincipalPolicyBundleRepository(
          execSql,
        ).loadAllPrincipalPolicyBundles()
      ).map((entry) => entry.currentState.stateHash);
      expect([...new Set(stateHashes)].sort()).toEqual(
        [version1, version2, version3]
          .map((entry) => entry.currentState.stateHash)
          .sort(),
      );
      expect(stateHashes).toHaveLength(3);
    } finally {
      close();
    }
  },
);

test("verified policy retention rejects a mismatched proof", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-retention-mismatch",
  );
  try {
    const { bundle: version1 } = await createPrincipalPolicyBundle();
    const version2 = successorBundleForPersistence(version1);
    const differentVersion2 = successorBundleForPersistence(version1, "4");

    await expect(
      new PrincipalPolicyBundleRepository(
        execSql,
      ).retainVerifiedPrincipalPolicyBundle({
        organizationId: "org-1",
        bundle: version2,
        policy: verifiedPolicyForPersistence(differentVersion2),
        updatedAt: "2026-04-08T00:02:00Z",
      }),
    ).rejects.toThrow("Verified principal policy bundle history mismatch");
    await expect(
      new PrincipalPolicyBundleRepository(
        execSql,
      ).loadAllPrincipalPolicyBundles(),
    ).resolves.toEqual([]);
  } finally {
    close();
  }
});
