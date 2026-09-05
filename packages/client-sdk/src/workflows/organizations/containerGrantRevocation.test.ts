import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createMutationResponseFromRequest,
  createParentProjection,
} from "../../../test/helpers/containerFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { loadAccessManifestCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { revokeOrganizationContainerGrant } from "./containerGrantRevocation";

test("organization revocation cannot acknowledge or cascade after cancellation", async () => {
  const revokedUserId = "revoked-user";
  const recipient = generateKemSeedAndKeyPair();
  const parent = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "read",
      publicKey: recipient.publicKey,
      recipientKeyEpochId: `user:${revokedUserId}:encapsulation:${await toFingerprint(recipient.publicKey)}`,
      userId: revokedUserId,
    },
  });
  const database = await createTestExecSql("cancelled-org-grant-revoke");
  let active = true;
  let submitted = false;
  let recites = 0;
  try {
    await expect(
      revokeOrganizationContainerGrant({
        apiClient: {
          getContainerWriterProjection: async () => parent.projection,
          revokeContainer: async (_id, request) => {
            submitted = true;
            const response = await createMutationResponseFromRequest(
              request,
              parent.projection.containerKeks.at(-1),
            );
            active = false;
            return response;
          },
          reciteContainer: async () => {
            recites += 1;
            return null;
          },
        },
        containerId: parent.projection.containerId,
        encapsulationKeyPair: {
          publicKey: parent.encapsulationPublicKey,
          secretKey: parent.secretKey,
        },
        execSql: database.execSql,
        organizationId: parent.author.organizationId,
        reportSecurityIncident: async () => {},
        resolveTrustedUserIdentity: async (userId) =>
          createTestTrustedUserIdentity({
            userId,
            encapsulationPublicKey:
              userId === revokedUserId
                ? recipient.publicKey
                : parent.encapsulationPublicKey,
            signingKeyFingerprint: parent.author.signerKeyFingerprint,
            signingPublicKey: parent.signingPublicKey,
          }),
        revokedSubject: { subjectType: "user", subjectId: revokedUserId },
        signerUserId: parent.author.signerUserId,
        signingFingerprint: parent.author.signerKeyFingerprint,
        signingKeyPair: {
          signingPrivateKey: parent.author.signerPrivateKey,
          signingPublicKey: parent.signingPublicKey,
        },
        stillCurrent: () => active,
      }),
    ).rejects.toThrow("could not be revoked");
    expect(submitted).toBe(true);
    expect(recites).toBe(0);
    const checkpoint = await loadAccessManifestCheckpoint(
      database.execSql,
      "container",
      parent.author.organizationId,
      parent.projection.containerId,
    );
    expect(checkpoint?.epoch).toBe(1);
  } finally {
    database.close();
  }
});
