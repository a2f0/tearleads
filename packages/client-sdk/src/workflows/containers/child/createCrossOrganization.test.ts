import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair, toFingerprint } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthor,
  createParentProjection,
  createParentProjectionUserKeyResolver,
} from "../../../../test/helpers/containerFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../../test/helpers/trustedUserIdentity";
import { buildMaterializedContainerCreatePlan } from "./create";

test.each(["write", "read"] as const)(
  "cross-organization child creation checks the parent's %s grant",
  async (accessLevel) => {
    const database = await createTestExecSql(`cross-org-child-${accessLevel}`);
    const keys = generateKemSeedAndKeyPair();
    const signer = await createAuthor({
      organizationId: "another-active-organization",
      userId: "cross-org-author",
    });
    const parent = await createParentProjection({
      existingUserRecipient: {
        accessLevel,
        publicKey: keys.publicKey,
        recipientKeyEpochId: `user:cross-org-author:encapsulation:${await toFingerprint(keys.publicKey)}`,
        userId: "cross-org-author",
      },
    });
    const ownerResolver = createParentProjectionUserKeyResolver(parent);
    const signerResolver = createTestTrustedUserIdentityResolver({
      encapsulationPublicKey: keys.publicKey,
      signingKeyFingerprint: signer.author.signerKeyFingerprint,
      signingPublicKey: signer.signingPublicKey,
      userId: signer.author.signerUserId,
    });
    try {
      const result = buildMaterializedContainerCreatePlan({
        author: signer.author,
        execSql: database.execSql,
        parentProjection: parent.projection,
        parentSecretKey: keys.secretKey,
        resolveProjectionUserKey: (userId) =>
          userId === parent.userId
            ? ownerResolver(userId)
            : signerResolver(userId),
      });
      if (accessLevel === "read") {
        await expect(result).rejects.toMatchObject({ code: "unauthorized" });
        return;
      }
      const { plan } = await result;
      expect(plan.state.organizationId).toBe(parent.projection.organizationId);
      expect(plan.event.organizationId).toBe(parent.projection.organizationId);
      expect(plan.event.signerUserId).toBe(signer.author.signerUserId);
    } finally {
      await database.close();
    }
  },
);
