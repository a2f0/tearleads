import { expect, test } from "bun:test";
import {
  buildPrincipalStateSigningInput,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  computeContainerKekMaterialId,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  computePrincipalStateHash,
  deriveContainerKekWrappingPublicKey,
  derivePrincipalRecipientKeyEpochId,
  generateKemSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql, type TestExecSql } from "@tearleads/test-utils";
import type {
  ContainerWriterProjectionResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import {
  createContainerManifestFixture,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createUserContainerWrap,
  SIGNED_AT,
} from "../../../../test/helpers/containerFixtures";
import { createProjectionPolicyEvidence } from "../../../../test/helpers/projectionPolicyEvidence";
import { unwrapContainerKekPath } from "../../documents/shared/containerKekPath";
import {
  ensurePrincipalPolicyTables,
  savePrincipalPolicyBundle,
} from "../../persistence/principalPolicyPersistence";

async function createGroupPrincipalPolicyBundle(input: {
  memberRecipientPublicKeys: Array<{
    userId: string;
    publicKey: Uint8Array;
  }>;
  members: Array<{ userId: string }>;
  principalId: string;
  principalKem: {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  };
  signedAt: string;
  signer: {
    recipientPublicKey: Uint8Array;
    signerKeyFingerprint: string;
    signerPrivateKey: Uint8Array;
    signerUserId: string;
  };
}): Promise<PrincipalPolicyBundleResponse> {
  const currentProjection = [
    {
      userId: input.signer.signerUserId,
      role: "admin" as const,
    },
    ...input.members.map((member) => ({
      userId: member.userId,
      role: "member" as const,
    })),
  ];
  const payloadCiphertext = `${input.principalId}-payload`;
  const recipients = [
    {
      userId: input.signer.signerUserId,
      publicKey: input.signer.recipientPublicKey,
    },
    ...input.memberRecipientPublicKeys,
  ];
  const wrappedMembers = await wrapDekForRecipients(
    input.principalKem.secretKey,
    recipients.map((recipient) => recipient.publicKey),
  );
  const memberEnvelopes = recipients.map((recipient, index) => {
    const wrappedMember = wrappedMembers[index];
    if (!wrappedMember) {
      throw new Error("Expected wrapped principal member key");
    }

    return {
      userId: recipient.userId,
      memberKeyFingerprint: wrappedMember.keyFingerprint,
      kemCipherText: bytesToBase64(wrappedMember.kemCipherText),
      wrappedKey: bytesToBase64(wrappedMember.wrappedKey),
    };
  });
  const signedState = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: input.principalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(input.principalKem.publicKey),
      keyFingerprint: await toFingerprint(input.principalKem.publicKey),
      members: currentProjection.map((member) => ({ userId: member.userId })),
      memberEnvelopes,
      projection: currentProjection,
      grants: [],
      payloadCiphertext,
      externalAuthority: null,
      signedAt: input.signedAt,
      signerUserId: input.signer.signerUserId,
      signerUserKeyFingerprint: input.signer.signerKeyFingerprint,
    }),
    input.signer.signerPrivateKey,
  );
  const stateHash = await computePrincipalStateHash(signedState);

  return {
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: input.principalId,
      stateHash,
      epoch: 1,
      envelopes: memberEnvelopes,
    },
    currentPayload: {
      principalType: "group",
      principalId: input.principalId,
      stateHash,
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: signedState.payloadCiphertextHash,
      createdAt: input.signedAt,
    },
    currentGrants: [],
    currentProjection,
    currentState: {
      ...signedState,
      createdAt: input.signedAt,
      stateHash,
    },
    previousStates: [],
  };
}

async function withProjectionDatabase<T>(
  name: string,
  run: (execSql: TestExecSql) => Promise<T>,
): Promise<T> {
  const { close, execSql } = await createTestExecSql(name);
  try {
    return await run(execSql);
  } finally {
    close();
  }
}

test("unwrapContainerKekPath verifies cached group policies before managed-principal unwrap", async () => {
  const parent = await createParentProjection();
  const groupKem = generateKemSeedAndKeyPair();
  const groupMemberKem = generateKemSeedAndKeyPair();
  const groupMemberUserId = "group-member-user";
  const groupBundle = await createGroupPrincipalPolicyBundle({
    memberRecipientPublicKeys: [
      {
        userId: groupMemberUserId,
        publicKey: groupMemberKem.publicKey,
      },
    ],
    members: [{ userId: groupMemberUserId }],
    principalId: "group-managed-container-access",
    principalKem: groupKem,
    signedAt: SIGNED_AT,
    signer: {
      ...parent.author,
      recipientPublicKey: parent.encapsulationPublicKey,
    },
  });
  const groupHead = {
    principalType: "group" as const,
    principalId: groupBundle.currentState.principalId,
    version: groupBundle.currentState.version,
    keyEpoch: groupBundle.currentState.keyEpoch,
    stateHash: groupBundle.currentState.stateHash,
    keyFingerprint: groupBundle.currentState.keyFingerprint,
  };
  const containerId = "managed-group-container";
  const containerKek = crypto.getRandomValues(new Uint8Array(32));
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId,
    keyEpoch: 1,
    keyMaterial: containerKek,
  });
  const manifest = await createContainerManifestFixture({
    containerKeyPublicKey: await deriveContainerKekWrappingPublicKey({
      containerId,
      keyMaterial: containerKek,
    }),
    author: parent.author,
    containerId,
    containerKeyEpochId,
    directGrants: [
      {
        subjectType: "group",
        subjectId: groupHead.principalId,
        accessLevel: "write",
      },
      {
        subjectType: "user",
        subjectId: parent.userId,
        accessLevel: "admin",
      },
    ],
    eventId: "managed-group-container-event-1",
    metadataDocumentId: "managed-group-container-metadata-document",
    organizationId: parent.projection.organizationId,
    referencedPrincipalHeads: [groupHead],
    signingPublicKey: parent.signingPublicKey,
  });
  const signerRecipientKeyFingerprint = await toFingerprint(
    parent.encapsulationPublicKey,
  );
  const signerRecipientKeyEpochId = `user:${parent.userId}:encapsulation:${signerRecipientKeyFingerprint}`;
  const signerWrap = await createUserContainerWrap({
    containerKeyEpochId,
    containerKek,
    publicKey: parent.encapsulationPublicKey,
    recipientKeyEpochId: signerRecipientKeyEpochId,
    userId: parent.userId,
    wrapManifestHash: manifest.manifestHash,
  });
  const [groupWrappedKek] = await wrapDekForRecipients(containerKek, [
    groupKem.publicKey,
  ]);
  if (!groupWrappedKek) {
    throw new Error("Expected wrapped group KEK");
  }
  const groupRecipientTarget: ContainerKekRecipientTarget = {
    recipientKind: "group",
    recipientId: groupHead.principalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(groupHead),
    recipientKeyFingerprint: groupWrappedKek.keyFingerprint,
  };
  const userRecipientTarget: ContainerKekRecipientTarget = {
    recipientKind: "user",
    recipientId: parent.userId,
    recipientKeyEpochId: signerRecipientKeyEpochId,
    recipientKeyFingerprint: signerWrap.recipientKeyFingerprint,
  };
  const recipientTargets = [groupRecipientTarget, userRecipientTarget];
  const keyEpoch: ContainerKeyEpoch = {
    id: containerKeyEpochId,
    containerId,
    keyEpoch: 1,
    accessManifestHash: manifest.manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: manifest.event.eventHash,
    createdByManifestHash: manifest.manifestHash,
  };
  const projection: ContainerWriterProjectionResponse = {
    policyEvidence: await createProjectionPolicyEvidence({
      author: parent.author,
      group: groupBundle,
      signingPublicKey: parent.signingPublicKey,
      encapsulationKeyPair: {
        publicKey: parent.encapsulationPublicKey,
        secretKey: parent.secretKey,
      },
    }),
    containerId,
    organizationId: parent.projection.organizationId,
    path: [
      manifest as unknown as ContainerWriterProjectionResponse["path"][number],
    ],
    containerKeks: [
      {
        accessManifestHash: manifest.manifestHash,
        containerId,
        containerKeyEpoch: 1,
        containerKeyEpochId,
        keyEpoch: keyEpoch as unknown as Record<string, unknown>,
        keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
        keyTargetHash:
          await computeContainerKekRecipientTargetHash(recipientTargets),
        parentContainerKeyEpochId: null,
        containerManifestHistory: [],
        keyring: null,
        recipientTargets: recipientTargets as unknown as Record<
          string,
          unknown
        >[],
        wraps: [
          signerWrap,
          {
            containerKeyEpochId,
            recipientKind: "group",
            recipientId: groupHead.principalId,
            recipientKeyEpochId: groupRecipientTarget.recipientKeyEpochId,
            recipientKeyFingerprint: groupWrappedKek.keyFingerprint,
            kemCipherText: bytesToBase64(groupWrappedKek.kemCipherText),
            wrappedKey: bytesToBase64(groupWrappedKek.wrappedKey),
            wrapManifestHash: manifest.manifestHash,
          },
        ],
      },
    ],
  };
  const resolveProjectionUserKey =
    createParentProjectionUserKeyResolver(parent);
  const { close, execSql } = await createTestExecSql(
    "managed-principal-projection-verification",
  );

  try {
    await ensurePrincipalPolicyTables(execSql);
    await savePrincipalPolicyBundle(
      execSql,
      groupBundle,
      "2026-04-28T12:01:00.000Z",
      parent.author.organizationId,
    );

    const groupMemberKeks = await unwrapContainerKekPath({
      execSql,
      projection,
      resolveProjectionUserKey,
      secretKey: groupMemberKem.secretKey,
    });

    expect(Array.from(groupMemberKeks.get(containerKeyEpochId) ?? [])).toEqual(
      Array.from(containerKek),
    );
  } finally {
    close();
  }
});

test("unwrapContainerKekPath fails closed for managed-principal KEK projections", async () => {
  const parent = await createParentProjection();
  const groupHead = {
    principalType: "group" as const,
    principalId: "group-1",
    version: 1,
    keyEpoch: 1,
    stateHash: await toFingerprint(new TextEncoder().encode("group-state-1")),
    keyFingerprint: await toFingerprint(
      new TextEncoder().encode("group-key-1"),
    ),
  };
  const managedManifest = await createContainerManifestFixture({
    containerKeyPublicKey: await deriveContainerKekWrappingPublicKey({
      containerId: parent.parentKekState.containerId,
      keyMaterial: parent.parentContainerKek,
    }),
    author: parent.author,
    containerId: parent.parentKekState.containerId,
    containerKeyEpochId: parent.parentKekState.containerKeyEpochId,
    directGrants: [
      {
        subjectType: "user",
        subjectId: parent.userId,
        accessLevel: "admin",
      },
      {
        subjectType: "group",
        subjectId: groupHead.principalId,
        accessLevel: "write",
      },
    ],
    eventId: "managed-parent-container-event-1",
    metadataDocumentId: "parent-container-metadata-document",
    organizationId: parent.projection.organizationId,
    referencedPrincipalHeads: [groupHead],
    signingPublicKey: parent.signingPublicKey,
  });
  const managedProjection: ContainerWriterProjectionResponse = {
    ...parent.projection,
    path: [
      managedManifest as unknown as ContainerWriterProjectionResponse["path"][number],
    ],
  };

  await withProjectionDatabase(
    "projection-missing-group-policy",
    async (execSql) =>
      await expect(
        unwrapContainerKekPath({
          execSql,
          projection: managedProjection,
          resolveProjectionUserKey:
            createParentProjectionUserKeyResolver(parent),
          secretKey: parent.secretKey,
        }),
      ).rejects.toThrow("Projection omits required principal policy evidence"),
  );
});
