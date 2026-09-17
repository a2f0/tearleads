import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../test/helpers/containerFixtures";
import { createTestGroupMetadataProjection } from "../../../test/helpers/groupMetadataProjection";
import { policyBundleFromInitialRequest } from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import {
  ensureContainerTables,
  saveContainer,
} from "../../data/persistence/containers/containerPersistence";
import { buildMaterializedContainerRekeyPlan } from "../containers/child/rekey";
import { containerWriterProjectionFromRekeyPlan } from "../containers/child/rekeyProjection";
import { createGroupMetadataAccess } from "./groupMetadataAccess";
import { buildInitialGroupPolicyRequest } from "./principalPolicyRequest";

async function fixture() {
  const member = generateKemSeedAndKeyPair();
  const parent = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "read",
      publicKey: member.publicKey,
      recipientKeyEpochId: `user:directory-member:encapsulation:${await toFingerprint(member.publicKey)}`,
      userId: "directory-member",
    },
  });
  const ownerResolver = createParentProjectionUserKeyResolver(parent);
  const resolveProjectionUserKey = async (userId: string) =>
    userId === "directory-member"
      ? createTestTrustedUserIdentity({
          userId,
          encapsulationPublicKey: member.publicKey,
          signingPublicKey: parent.signingPublicKey,
          signingKeyFingerprint: parent.author.signerKeyFingerprint,
        })
      : ownerResolver(userId);
  const metadata = await createTestGroupMetadataProjection(
    parent,
    resolveProjectionUserKey,
  );
  const request = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
    groupId: "private-custom-group",
    name: "Confidential team",
    metadataKey: metadata.key,
    includeSignerAsAdmin: false,
    signerUserId: parent.userId,
    signingFingerprint: parent.author.signerKeyFingerprint,
    signingKeyPair: {
      signingPrivateKey: parent.author.signerPrivateKey,
      signingPublicKey: parent.signingPublicKey,
    },
  });
  return {
    parent,
    member,
    metadata,
    resolveProjectionUserKey,
    bundle: await policyBundleFromInitialRequest(request),
  };
}

test("organization metadata readers decrypt a group with no group membership or group key", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-metadata-nonmember",
  );
  try {
    const { parent, member, metadata, resolveProjectionUserKey, bundle } =
      await fixture();
    expect(bundle.currentProjection).toEqual([]);
    expect(bundle.currentMemberEnvelopes.envelopes).toEqual([]);
    const access = (targetSecretKey: Uint8Array) =>
      createGroupMetadataAccess({
        apiClient: {
          getContainerWriterProjection: async () => metadata.projection,
        },
        execSql,
        organizationId: parent.author.organizationId,
        resolveProjectionUserKey,
        targetSecretKey,
      });
    await expect(access(member.secretKey).readName(bundle)).resolves.toBe(
      "Confidential team",
    );
    await expect(
      access(generateKemSeedAndKeyPair().secretKey).readName(bundle),
    ).rejects.toThrow();
  } finally {
    close();
  }
});

test("a fresh reader recovers existing group names after metadata key rotation", async () => {
  const { close, execSql } = await createTestExecSql("group-metadata-keyring");
  try {
    const { parent, member, metadata, resolveProjectionUserKey, bundle } =
      await fixture();
    const materializedPlan = await buildMaterializedContainerRekeyPlan({
      author: parent.author,
      execSql,
      previousProjection: metadata.projection,
      resolveProjectionUserKey,
      targetSecretKey: parent.secretKey,
    });
    const rotated = await containerWriterProjectionFromRekeyPlan({
      materializedPlan,
      previousProjection: metadata.projection,
    });
    expect(rotated.containerKeks.at(-1)?.containerKeyEpochId).not.toBe(
      metadata.key.containerKeyEpochId,
    );
    const access = createGroupMetadataAccess({
      apiClient: { getContainerWriterProjection: async () => rotated },
      execSql,
      organizationId: parent.author.organizationId,
      resolveProjectionUserKey,
      targetSecretKey: member.secretKey,
    });
    await expect(access.readName(bundle)).resolves.toBe("Confidential team");
  } finally {
    close();
  }
});

test("an unsigned projection change or a different signed system container cannot supply a name key", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-metadata-substitution",
  );
  try {
    const { parent, metadata, resolveProjectionUserKey, bundle } =
      await fixture();
    const target = metadata.projection.path.at(-1);
    if (!target) throw new Error("Expected metadata manifest");
    const forged = {
      ...metadata.projection,
      path: [
        ...metadata.projection.path.slice(0, -1),
        { ...target, state: { ...target.state, systemSlot: "forged" } },
      ],
    };
    for (const projection of [forged, parent.projection]) {
      const access = createGroupMetadataAccess({
        apiClient: { getContainerWriterProjection: async () => projection },
        execSql,
        organizationId: parent.author.organizationId,
        resolveProjectionUserKey,
        targetSecretKey: parent.secretKey,
      });
      await expect(access.readName(bundle)).rejects.toThrow();
    }
  } finally {
    close();
  }
});

test("group creation discovers and verifies the organization metadata key", async () => {
  const { close, execSql } = await createTestExecSql(
    "group-metadata-discovery",
  );
  try {
    const { parent, metadata, resolveProjectionUserKey } = await fixture();
    const organizationId = parent.author.organizationId;
    await ensureContainerTables(execSql);
    const access = createGroupMetadataAccess({
      apiClient: {
        getContainerWriterProjection: async () => metadata.projection,
      },
      execSql,
      organizationId,
      resolveProjectionUserKey,
      targetSecretKey: parent.secretKey,
    });
    await expect(access.loadEncryptionKey()).rejects.toThrow(
      "has not been discovered",
    );
    await saveContainer(execSql, {
      id: metadata.key.containerId,
      organizationId,
      parentId: parent.projection.containerId,
      metadataDocumentId: null,
      systemSlot: await deriveOrganizationMetadataContainerSystemSlot({
        organizationId,
      }),
      name: "Organization metadata",
      icon: null,
    });
    await expect(access.loadEncryptionKey()).resolves.toEqual(metadata.key);
  } finally {
    close();
  }
});
