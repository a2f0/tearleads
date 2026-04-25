import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  computePrincipalStatePayloadCiphertextHash,
  encryptForRecipients,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { createTestExecSql } from "../../test/helpers/createTestExecSql";
import { decryptBlobEnvelope, serializeBlobEnvelope } from "./blobEnvelope";
import {
  ensurePrincipalPolicyTables,
  savePrincipalPolicyBundle,
} from "./persistence/principalPolicyPersistence";
import { unwrapRecipientEnvelopesWithPrincipalPolicies } from "./principalPolicyCrypto";

async function createPrincipalPolicyBundle(input: {
  keyEpoch?: number;
  members: Array<{ principalType: "user" | "group"; principalId: string }>;
  memberRecipientPublicKeys: Array<{
    memberPrincipalId: string;
    memberPrincipalType: "user" | "group";
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
      memberPrincipalType: "user" as const,
      memberPrincipalId: signerUserId,
      role: "admin" as const,
    },
    ...input.members.map((member) => ({
      memberPrincipalType: member.principalType,
      memberPrincipalId: member.principalId,
      role: "member" as const,
    })),
  ];
  const signedState = await signPrincipalState(
    {
      principalType: "group",
      principalId: input.principalId,
      version,
      prevStateHash: null,
      keyEpoch,
      encapsulationPublicKey: bytesToBase64(input.principalKem.publicKey),
      keyFingerprint: await toFingerprint(input.principalKem.publicKey),
      members: input.members,
      projection: currentProjection,
      payloadCiphertext: `${input.principalId}-ciphertext`,
      signedAt: input.signedAt,
      signerUserId,
      signerUserKeyFingerprint,
    },
    signingPrivateKey,
  );
  const stateHash = await computePrincipalStateHash(signedState);
  const memberRecipientEntries = await wrapDekForRecipients(
    input.principalKem.secretKey,
    input.memberRecipientPublicKeys.map((recipient) => recipient.publicKey),
  );

  return {
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: input.principalId,
      stateHash,
      epoch: keyEpoch,
      envelopes: input.memberRecipientPublicKeys.map((recipient, index) => {
        const recipientEntry = memberRecipientEntries[index];

        if (!recipientEntry) {
          throw new Error("Missing wrapped member recipient entry");
        }

        return {
          memberPrincipalType: recipient.memberPrincipalType,
          memberPrincipalId: recipient.memberPrincipalId,
          memberKeyFingerprint: recipientEntry.keyFingerprint,
          kemCipherText: bytesToBase64(recipientEntry.kemCipherText),
          wrappedKey: bytesToBase64(recipientEntry.wrappedKey),
        };
      }),
    },
    currentState: {
      ...signedState,
      createdAt: input.signedAt,
      stateHash,
    },
    currentProjection,
    currentPayload: {
      principalType: "group",
      principalId: input.principalId,
      stateHash,
      cipherSuite: "aes-256-gcm-v1",
      ciphertext:
        signedState.payloadCiphertext ?? `${input.principalId}-ciphertext`,
      ciphertextHash: await computePrincipalStatePayloadCiphertextHash(
        signedState.payloadCiphertext ?? `${input.principalId}-ciphertext`,
      ),
      createdAt: input.signedAt,
    },
  };
}

test("principal policy crypto unwraps a blob envelope addressed to a cached group principal", async () => {
  const aliceKem = generateKemSeedAndKeyPair();
  const groupKem = generateKemSeedAndKeyPair();
  const { close, execSql } = await createTestExecSql(
    "principal-policy-crypto-test",
  );

  try {
    const bundle = await createPrincipalPolicyBundle({
      members: [{ principalType: "user", principalId: "alice" }],
      memberRecipientPublicKeys: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: "alice",
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
    );

    const envelope = await encryptForRecipients(
      new TextEncoder().encode("hello-principal-blob"),
      [groupKem.publicKey],
    );
    const encryptedBytes = serializeBlobEnvelope(envelope);

    await expect(
      decryptBlobEnvelope(encryptedBytes, aliceKem.secretKey, execSql),
    ).resolves.toEqual(new TextEncoder().encode("hello-principal-blob"));
  } finally {
    close();
  }
});

test("principal policy crypto recursively unwraps nested group principals", async () => {
  const aliceKem = generateKemSeedAndKeyPair();
  const nestedGroupKem = generateKemSeedAndKeyPair();
  const outerGroupKem = generateKemSeedAndKeyPair();
  const objectKey = crypto.getRandomValues(new Uint8Array(32));
  const { close, execSql } = await createTestExecSql(
    "principal-policy-crypto-test",
  );

  try {
    const nestedBundle = await createPrincipalPolicyBundle({
      members: [{ principalType: "user", principalId: "alice" }],
      memberRecipientPublicKeys: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: "alice",
          publicKey: aliceKem.publicKey,
        },
      ],
      principalId: "group-nested",
      principalKem: nestedGroupKem,
      signedAt: "2026-04-08T00:00:00.000Z",
    });
    const outerBundle = await createPrincipalPolicyBundle({
      members: [{ principalType: "group", principalId: "group-nested" }],
      memberRecipientPublicKeys: [
        {
          memberPrincipalType: "group",
          memberPrincipalId: "group-nested",
          publicKey: nestedGroupKem.publicKey,
        },
      ],
      principalId: "group-outer",
      principalKem: outerGroupKem,
      signedAt: "2026-04-08T00:02:00.000Z",
    });
    const wrappedObjectEntries = await wrapDekForRecipients(objectKey, [
      outerGroupKem.publicKey,
    ]);
    const wrappedObjectEntry = wrappedObjectEntries[0];

    if (!wrappedObjectEntry) {
      throw new Error("Missing wrapped object recipient entry");
    }

    await ensurePrincipalPolicyTables(execSql);
    await savePrincipalPolicyBundle(
      execSql,
      nestedBundle,
      "2026-04-08T00:01:00.000Z",
    );
    await savePrincipalPolicyBundle(
      execSql,
      outerBundle,
      "2026-04-08T00:03:00.000Z",
    );

    await expect(
      unwrapRecipientEnvelopesWithPrincipalPolicies({
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
