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
