import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type {
  ContainerMutationResponse,
  OrganizationReadModelDeltaResponse,
} from "@tearleads/validators/response";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createRecipientIdentityResolver,
  SIGNED_AT,
} from "../../../../../test/helpers/data/containerFixtures";
import { createContainerMutationServiceFixture } from "../../../../../test/helpers/workflows/containerMutationServiceFixture";

const WRONG_HASH = "0".repeat(64);

function delta(organizationId: string): OrganizationReadModelDeltaResponse {
  return {
    version: 6,
    mode: "delta",
    organizationId,
    nextCursor: "cursor-2",
    hasMore: false,
    currentUser: { isOrgAdmin: true },
    lanes: { grants: { organizationId, grants: [] } },
  };
}

/** A share through the status-bearing endpoint, holding `cursor-1`. */
async function shareHolding(input: {
  readonly cancelDuringLookup?: boolean;
  readonly tamper?: (
    response: ContainerMutationResponse,
  ) => ContainerMutationResponse;
}) {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const recipientKeyPair = generateKemSeedAndKeyPair();
  const database = await createTestExecSql("container-share-committed");
  const sentCursors: Array<string | undefined> = [];
  const settled: Array<OrganizationReadModelDeltaResponse | undefined> = [];
  let current = true;
  const readModel = delta(parent.projection.organizationId);
  try {
    const outcome = await createContainerMutationServiceFixture({
      reportSecurityIncident: async () => {},
      api: {
        reciteContainer: async () => null,
        getContainerWriterProjection: async () => parent.projection,
        shareContainer: async () => null,
        shareContainerResult: async (_containerId, request, options) => {
          sentCursors.push(options?.readModelCursor);
          const response = await createMutationResponseFromRequest(request);
          return {
            ok: true,
            data: { ...(input.tamper?.(response) ?? response), readModel },
          };
        },
      },
      execSql: database.execSql,
      resolveTrustedUserIdentity: createRecipientIdentityResolver({
        encapsulationPublicKey: recipientKeyPair.publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey: parent.signingPublicKey,
      }),
      encapsulationSecretKey: parent.secretKey,
    })
      .shareRemoteContainer({
        accessLevel: "read",
        author,
        committedReadModel: {
          begin: async () => {
            if (input.cancelDuringLookup) current = false;
            return {
              heldCursor: "cursor-1",
              settle: (offered) => settled.push(offered),
            };
          },
        },
        containerId: parent.projection.containerId,
        recipientUserId: "user-2",
        resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
        signedAt: SIGNED_AT,
        stillCurrent: () => current,
      })
      .catch((error: unknown) => error);
    return { outcome, readModel, sentCursors, settled };
  } finally {
    database.close();
  }
}

test("a share sends its held cursor and offers the delta once acknowledged", async () => {
  const { outcome, readModel, sentCursors, settled } = await shareHolding({});

  expect(outcome).toMatchObject({ response: { readModel } });
  expect(sentCursors).toEqual(["cursor-1"]);
  expect(settled).toEqual([readModel]);
});

test("a share whose acknowledgement is refused offers no delta", async () => {
  const { outcome, sentCursors, settled } = await shareHolding({
    tamper: (response) => ({
      ...response,
      manifestHead: { ...response.manifestHead, manifestHash: WRONG_HASH },
    }),
  });

  expect(outcome).toBeInstanceOf(Error);
  expect(sentCursors).toEqual(["cursor-1"]);
  expect(settled).toEqual([undefined]);
});

test("a share overtaken during the cursor lookup sends nothing", async () => {
  const { outcome, sentCursors, settled } = await shareHolding({
    cancelDuringLookup: true,
  });

  expect(outcome).toBeNull();
  expect(sentCursors).toEqual([]);
  expect(settled).toEqual([undefined]);
});
