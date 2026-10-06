import { expect, test } from "bun:test";
import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  ensurePrincipalPolicyTables,
  savePrincipalPolicyBundle,
} from "../persistence/principalPolicyPersistence";
import {
  principalHistoryEvidenceTables,
  principalHistoryPrefixes,
} from "../sqlite/principalHistoryEvidenceSchema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../sqlite/sqlSchema";
import { unwrapKeyEnvelopesWithPrincipalPolicies } from "./principalPolicyCrypto";

async function createPrincipalPolicyBundle(input: {
  keyEpoch?: number;
  members: Array<{ userId: string }>;
  memberRecipientPublicKeys: Array<{
    userId: string;
    publicKey: Uint8Array;
  }>;
  principalId: string;
  principalKem: {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  };
  signedAt: string;
  version?: number;
}): Promise<PrincipalPolicyBundleResponse> {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const keyEpoch = input.keyEpoch ?? 1;
  const version = input.version ?? 1;
  const signerUserId = `${input.principalId}-signer-user`;
  const signerUserKeyFingerprint = await toFingerprint(signingPublicKey);
  const currentProjection = [
    {
      userId: signerUserId,
      role: "admin" as const,
    },
    ...input.members.map((member) => ({
      userId: member.userId,
      role: "member" as const,
    })),
  ];
  const payloadCiphertext = `${input.principalId}-ciphertext`;
  const signerRecipientKem = generateKemSeedAndKeyPair();
  const recipients = [
    {
      userId: signerUserId,
      publicKey: signerRecipientKem.publicKey,
    },
    ...input.memberRecipientPublicKeys,
  ];
  const memberRecipientEntries = await wrapDekForRecipients(
    input.principalKem.secretKey,
    recipients.map((recipient) => recipient.publicKey),
  );
  const memberEnvelopes = recipients.map((recipient, index) => {
    const recipientEntry = memberRecipientEntries[index];

    if (!recipientEntry) {
      throw new Error("Missing wrapped member recipient entry");
    }

    return {
      userId: recipient.userId,
      memberKeyFingerprint: recipientEntry.keyFingerprint,
      kemCipherText: bytesToBase64(recipientEntry.kemCipherText),
      wrappedKey: bytesToBase64(recipientEntry.wrappedKey),
    };
  });
  const signedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: input.principalId,
      version,
      prevStateHash: null,
      keyEpoch,
      encapsulationPublicKey: bytesToBase64(input.principalKem.publicKey),
      keyFingerprint: await toFingerprint(input.principalKem.publicKey),
      members: currentProjection.map((member) => ({
        userId: member.userId,
      })),
      memberEnvelopes,
      projection: currentProjection,
      grants: [],
      payloadCiphertext,
      externalAuthority: null,
      signedAt: input.signedAt,
      signerUserId,
      signerUserKeyFingerprint,
    }),
    signingPrivateKey,
  );
  const stateHash = await computePrincipalStateHash(signedState);

  return {
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: input.principalId,
      stateHash,
      epoch: keyEpoch,
      envelopes: memberEnvelopes,
    },
    currentState: {
      ...signedState,
      createdAt: input.signedAt,
      stateHash,
    },
    currentProjection,
    currentGrants: [],
    currentPayload: {
      principalType: "group",
      principalId: input.principalId,
      stateHash,
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: signedState.payloadCiphertextHash,
      createdAt: input.signedAt,
    },
    previousStates: [],
  };
}

test("principal policy crypto unwraps an object key addressed to a cached group principal", async () => {
  const aliceKem = generateKemSeedAndKeyPair();
  const groupKem = generateKemSeedAndKeyPair();
  const objectKey = crypto.getRandomValues(new Uint8Array(32));
  const { close, execSql } = await createTestExecSql(
    "principal-policy-crypto-test",
  );

  try {
    const bundle = await createPrincipalPolicyBundle({
      members: [{ userId: "alice" }],
      memberRecipientPublicKeys: [
        {
          userId: "alice",
          publicKey: aliceKem.publicKey,
        },
      ],
      principalId: "group-1",
      principalKem: groupKem,
      signedAt: "2026-04-08T00:00:00.000Z",
    });

    await ensurePrincipalPolicyTables(execSql);
    await savePrincipalPolicyBundle(
      execSql,
      bundle,
      "2026-04-08T00:01:00.000Z",
      "org-1",
    );

    const [wrappedObjectEntry] = await wrapDekForRecipients(objectKey, [
      groupKem.publicKey,
    ]);
    if (!wrappedObjectEntry) {
      throw new Error("Missing wrapped object key entry");
    }

    await expect(
      unwrapKeyEnvelopesWithPrincipalPolicies({
        envelopes: [
          {
            keyFingerprint: wrappedObjectEntry.keyFingerprint,
            kemCipherText: bytesToBase64(wrappedObjectEntry.kemCipherText),
            wrappedKey: bytesToBase64(wrappedObjectEntry.wrappedKey),
          },
        ],
        execSql,
        secretKey: aliceKem.secretKey,
      }),
    ).resolves.toEqual(objectKey);
  } finally {
    close();
  }
});

test("paged envelope candidates open only their actual recipient key", async () => {
  const alice = generateKemSeedAndKeyPair();
  const group = generateKemSeedAndKeyPair();
  const wrongGroup = generateKemSeedAndKeyPair();
  const objectKey = crypto.getRandomValues(new Uint8Array(32));
  const { close, execSql } = await createTestExecSql(
    "paged-principal-key-candidates",
  );
  try {
    const bundle = await createPrincipalPolicyBundle({
      members: [{ userId: "alice" }],
      memberRecipientPublicKeys: [
        { userId: "alice", publicKey: alice.publicKey },
      ],
      principalId: "paged-group",
      principalKem: group,
      signedAt: "2026-04-08T00:00:00.000Z",
    });
    const wrong = await createPrincipalPolicyBundle({
      members: [{ userId: "alice" }],
      memberRecipientPublicKeys: [
        { userId: "alice", publicKey: alice.publicKey },
      ],
      principalId: "paged-group",
      principalKem: wrongGroup,
      signedAt: "2026-04-08T00:00:00.000Z",
    });
    const [wrapped] = await wrapDekForRecipients(objectKey, [group.publicKey]);
    if (!wrapped) throw new Error("Missing object key wrap");
    const input = {
      execSql,
      secretKey: alice.secretKey,
      envelopes: [
        {
          keyFingerprint: wrapped.keyFingerprint,
          kemCipherText: bytesToBase64(wrapped.kemCipherText),
          wrappedKey: bytesToBase64(wrapped.wrappedKey),
        },
      ],
    };
    await ensureSqlTables(execSql, principalHistoryEvidenceTables);
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    // Deliberately untrusted cache: this helper supplies keys, never authority.
    // Claimed fingerprints cannot make a different private key open the wrap.
    await db
      .insert(principalHistoryPrefixes)
      .values({
        scopeId: "cache",
        organizationId: "org",
        version: 1,
        headJson: "{}",
        progress: "untrusted",
        currentJson: JSON.stringify({
          ...wrong,
          currentState: bundle.currentState,
        }),
      })
      .run();
    await expect(
      unwrapKeyEnvelopesWithPrincipalPolicies(input),
    ).rejects.toThrow("No matching key envelope");
    await db
      .update(principalHistoryPrefixes)
      .set({ currentJson: JSON.stringify(bundle) })
      .run();
    await savePrincipalPolicyBundle(
      execSql,
      {
        ...wrong,
        currentState: bundle.currentState,
      },
      "2026-04-09T00:00:00.000Z",
      "org",
    );
    await expect(
      unwrapKeyEnvelopesWithPrincipalPolicies(input),
    ).resolves.toEqual(objectKey);
  } finally {
    close();
  }
});
