import { expect, test } from "bun:test";
import {
  computeContainerKekRecipientTargetHash,
  generateKemSeedAndKeyPair,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createRecipientIdentityResolver,
  SIGNED_AT,
} from "../../../../../test/helpers/containerFixtures";
import { shareRemoteContainer } from "./index";

const WRONG_HASH = "0".repeat(64);

type Tamper = (
  response: ContainerMutationResponse,
) => Promise<ContainerMutationResponse> | ContainerMutationResponse;

async function shareWith(tamper: Tamper) {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const database = await createTestExecSql("container-share-ack-hashes");
  try {
    return await shareRemoteContainer({
      reportSecurityIncident: async () => {},
      accessLevel: "read",
      apiClient: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async () => parent.projection,
        shareContainer: async (_containerId, request) =>
          tamper(await createMutationResponseFromRequest(request)),
      },
      author,
      containerId: parent.projection.containerId,
      execSql: database.execSql,
      recipientUserId: "user-2",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: createRecipientIdentityResolver({
        encapsulationPublicKey: recipientKeyPair.publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey: parent.signingPublicKey,
      }),
      signedAt: SIGNED_AT,
      targetSecretKey: parent.secretKey,
    });
  } finally {
    database.close();
  }
}

test("a share acknowledged by its hashes saves state built from the plan", async () => {
  const shared = await shareWith((response) => ({
    ...response,
    transportMetadata: "not part of the acknowledgement",
  }));
  if (!shared) throw new Error("Expected the share to be acknowledged");
  expect(shared.response.manifestHead.manifestHash).toBe(
    shared.plan.manifestHash,
  );
  expect(shared.response.eventHash).toBe(shared.plan.eventHash);
});

test.each<[string, Tamper, string]>([
  [
    "a substituted manifest",
    (response) => ({
      ...response,
      manifestHead: { ...response.manifestHead, manifestHash: WRONG_HASH },
    }),
    "manifest head mismatch",
  ],
  [
    "a substituted event",
    (response) => ({ ...response, eventHash: WRONG_HASH }),
    "manifest head mismatch",
  ],
  [
    "another parent",
    (response) => ({ ...response, parentId: "another-parent" }),
    "object identity mismatch",
  ],
  [
    "another key epoch",
    (response) => ({
      ...response,
      containerKek: { ...response.containerKek, containerKeyEpochId: "other" },
    }),
    "KEK identity mismatch",
  ],
  [
    "a substituted key epoch",
    (response) => ({
      ...response,
      containerKek: { ...response.containerKek, keyEpochHash: WRONG_HASH },
    }),
    "KEK commitment mismatch",
  ],
  [
    // #2158: a wrap stored for anyone else changes the recipient target hash.
    "a wrap for the wrong recipient",
    async (response) => ({
      ...response,
      containerKek: {
        ...response.containerKek,
        keyTargetHash: await computeContainerKekRecipientTargetHash([
          {
            recipientId: "intruder",
            recipientKeyEpochId: "intruder-key-epoch",
            recipientKeyFingerprint: WRONG_HASH,
            recipientKind: "user",
          },
        ]),
      },
    }),
    "KEK commitment mismatch",
  ],
  [
    "another parent key epoch",
    (response) => ({
      ...response,
      containerKek: {
        ...response.containerKek,
        parentContainerKeyEpochId: "other-parent-epoch",
      },
    }),
    "KEK commitment mismatch",
  ],
])(
  "a share acknowledgement naming %s is refused",
  async (_label, tamper, message) => {
    await expect(shareWith(tamper)).rejects.toThrow(message);
  },
);
