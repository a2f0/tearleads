import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createRecipientIdentityResolver,
  SIGNED_AT,
} from "../../../../../test/helpers/containerFixtures";
import { shareRemoteContainer } from "./index";

// A head on the signed path can advance while a share is in flight, most often
// under this device's own background re-citation after a share above it
// (#2647). The share is planned once more from a fresh projection; anything
// else the API refuses is final, and is reported as the plain endpoint would.

type Refusal = { readonly code?: string; readonly status: number };

const STALE_PATH: Refusal = {
  code: CONTAINER_MUTATION_ERROR_CODES.stateStale,
  status: 409,
};

async function shareAgainst(refusals: readonly Refusal[]) {
  const parent = await createParentProjection();
  const { author } = await createAuthor({
    organizationId: parent.projection.organizationId,
    userId: parent.userId,
  });
  const database = await createTestExecSql("container-share-stale-path");
  const submitted: ContainerMutationRequest[] = [];
  const counts = { evicted: 0, projections: 0, reported: 0 };
  try {
    const shared = await shareRemoteContainer({
      reportSecurityIncident: async () => {},
      accessLevel: "write",
      apiClient: {
        evictContainerWriterProjection: () => {
          counts.evicted += 1;
        },
        getContainerWriterProjection: async () => {
          counts.projections += 1;
          return parent.projection;
        },
        reciteContainer: async () => null,
        shareContainer: async () => {
          throw new Error("The status-bearing endpoint must be used");
        },
        shareContainerResult: async (_containerId, request) => {
          const refusal = refusals[submitted.length];
          submitted.push(request);
          if (!refusal) {
            return {
              ok: true,
              data: await createMutationResponseFromRequest(request),
            };
          }
          return {
            ...refusal,
            message: `Refused with ${refusal.status}`,
            ok: false,
            report: () => {
              counts.reported += 1;
            },
          };
        },
      },
      author,
      containerId: parent.projection.containerId,
      execSql: database.execSql,
      recipientUserId: "user-2",
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: createRecipientIdentityResolver({
        encapsulationPublicKey: generateKemSeedAndKeyPair().publicKey,
        signingKeyFingerprint: author.signerKeyFingerprint,
        signingPublicKey: parent.signingPublicKey,
      }),
      signedAt: SIGNED_AT,
      targetSecretKey: parent.secretKey,
    });
    return { counts, shared, submitted };
  } finally {
    database.close();
  }
}

test("a share refused for a stale path is planned again from a fresh projection", async () => {
  const { counts, shared, submitted } = await shareAgainst([STALE_PATH]);
  expect(shared).not.toBeNull();
  expect(submitted).toHaveLength(2);
  expect(counts).toEqual({ evicted: 1, projections: 2, reported: 0 });
});

test("a share refused for anything but a stale path is final and reported", async () => {
  const { counts, shared, submitted } = await shareAgainst([{ status: 403 }]);
  expect(shared).toBeNull();
  expect(submitted).toHaveLength(1);
  expect(counts).toEqual({ evicted: 0, projections: 1, reported: 1 });
});

test("a share is planned again only once", async () => {
  const { counts, shared, submitted } = await shareAgainst([
    STALE_PATH,
    STALE_PATH,
  ]);
  expect(shared).toBeNull();
  expect(submitted).toHaveLength(2);
  expect(counts).toEqual({ evicted: 1, projections: 2, reported: 1 });
});
