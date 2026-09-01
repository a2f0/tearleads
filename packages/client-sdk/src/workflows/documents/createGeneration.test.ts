import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@symcrypt/crypto";
import {
  createContainerWriterProjectionFixture,
  createTestExecSql,
} from "@symcrypt/test-utils";
import { createAuthor } from "../../../test/helpers/documentFixturePrimitives";
import { createResponseFromRequest } from "../../../test/helpers/documentResponseFixtures";
import { createTestTrustedUserIdentityResolver } from "../../../test/helpers/trustedUserIdentity";
import { createRemoteDocument } from "./create";

test("document create guards projection verification after generation expiry", async () => {
  const { author, signingPublicKey } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  const projection = await createContainerWriterProjectionFixture({
    containerId: "document-create-generation-container",
    encapsulationPublicKey: keyPair.publicKey,
    organizationId: author.organizationId,
    signerKeyFingerprint: author.signerKeyFingerprint,
    signerPrivateKey: author.signerPrivateKey,
    userId: author.signerUserId,
  });
  const resolveTrustedIdentity = createTestTrustedUserIdentityResolver({
    encapsulationPublicKey: keyPair.publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey,
    userId: author.signerUserId,
  });
  const database = await createTestExecSql(
    "document-create-projection-generation",
  );
  let submitted = false;
  let current = true;
  let primed = false;

  try {
    const created = await createRemoteDocument({
      apiClient: {
        createDocument: async (request) => {
          submitted = true;
          return createResponseFromRequest(request);
        },
        getContainerWriterProjection: async () => projection,
        primeDocumentWriterProjection: () => {
          primed = true;
        },
      },
      author,
      containerId: projection.containerId,
      documentId: "document-create-expired-verification",
      execSql: database.execSql,
      resolveProjectionUserKey: async (userId) => {
        const identity = await resolveTrustedIdentity(userId);
        if (submitted) current = false;
        return identity;
      },
      stillCurrent: () => current,
      targetSecretKey: keyPair.secretKey,
    });

    expect(created).toBeNull();
    expect(current).toBe(false);
    expect(primed).toBe(false);
  } finally {
    database.close();
  }
});
