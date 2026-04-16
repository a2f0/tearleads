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
import { createTestExecSql } from "../../test/helpers/createTestExecSql";
import {
  ensurePrincipalPolicyTables,
  loadPrincipalPolicyBundle,
  loadPrincipalPolicyStateHash,
} from "./persistence/principalPolicyPersistence";
import { cacheReferencedPrincipalPolicies } from "./principalPolicySync";

async function createPrincipalPolicyBundle(): Promise<{
  bundle: PrincipalPolicyBundleResponse;
  signerPublicKey: Uint8Array;
}> {
  const principalKem = generateKemSeedAndKeyPair();
  const principalKeyFingerprint = await toFingerprint(principalKem.publicKey);
  const { signingPublicKey: signerPublicKey, signingPrivateKey } =
    generateSigningSeedAndKeyPair();
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
    signerPublicKey,
  };
}

test("principal policy sync caches a verified referenced principal bundle and skips refetching unchanged state", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle, signerPublicKey } = await createPrincipalPolicyBundle();
    let getCurrentPrincipalPolicyCallCount = 0;

    await cacheReferencedPrincipalPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => {
        getCurrentPrincipalPolicyCallCount += 1;
        return bundle;
      },
      references: [
        {
          principalType: "group",
          principalId: "group-1",
          version: bundle.currentState.version,
          keyEpoch: bundle.currentState.keyEpoch,
          stateHash: bundle.currentState.stateHash,
        },
      ],
      trustedPolicySigners: new Map([["signer-1", signerPublicKey]]),
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
      references: [
        {
          principalType: "group",
          principalId: "group-1",
          version: bundle.currentState.version,
          keyEpoch: bundle.currentState.keyEpoch,
          stateHash: bundle.currentState.stateHash,
        },
      ],
      trustedPolicySigners: new Map([["signer-1", signerPublicKey]]),
    });

    expect(getCurrentPrincipalPolicyCallCount).toBe(1);
  } finally {
    close();
  }
});

test("principal policy sync skips untrusted bundles without persisting them", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const { bundle } = await createPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);

    await cacheReferencedPrincipalPolicies({
      execSql,
      getCurrentPrincipalPolicy: async () => bundle,
      references: [
        {
          principalType: "group",
          principalId: "group-1",
          version: bundle.currentState.version,
          keyEpoch: bundle.currentState.keyEpoch,
          stateHash: bundle.currentState.stateHash,
        },
      ],
      trustedPolicySigners: new Map(),
    });

    await expect(
      loadPrincipalPolicyBundle(execSql, "group", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});
