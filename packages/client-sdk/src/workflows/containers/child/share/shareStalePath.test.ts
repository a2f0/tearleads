import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import {
  CONTAINER_MUTATION_ERROR_CODES,
  type ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  createAuthor,
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createRecipientIdentityResolver,
  SIGNED_AT,
} from "../../../../../test/helpers/containerFixtures";
import { containerWriterProjectionFromSharePlan } from "../rekey/rekeyProjection";
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

// This device's own re-citation can pin a head past the projection a share is
// handed, and verification refuses that projection as a rollback. A refetch
// that serves the successor is verified against the new pin and signed; one
// that serves the old head again still fails, so a server cannot roll a head
// back through the retry.
async function shareBehindLocalPin(
  refetched: (paths: {
    readonly behind: ContainerWriterProjectionResponse;
    readonly successor: ContainerWriterProjectionResponse;
  }) => ContainerWriterProjectionResponse,
) {
  const parent = await createParentProjection();
  // The projection's own signer, so its successor verifies.
  const { author } = parent;
  const database = await createTestExecSql("container-share-behind-pin");
  const counts = { evicted: 0, projections: 0, submitted: 0 };
  const recipients = createRecipientIdentityResolver({
    encapsulationPublicKey: generateKemSeedAndKeyPair().publicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    signingPublicKey: parent.signingPublicKey,
  });
  const ownerKey = createParentProjectionUserKeyResolver(parent);
  // The successor path wraps to the first recipient as well as the owner.
  const resolveProjectionUserKey = (userId: string) =>
    userId === parent.userId ? ownerKey(userId) : recipients(userId);
  const share = (
    recipientUserId: string,
    project: () => ContainerWriterProjectionResponse,
  ) =>
    shareRemoteContainer({
      reportSecurityIncident: async () => {},
      accessLevel: "write",
      apiClient: {
        evictContainerWriterProjection: () => {
          counts.evicted += 1;
        },
        getContainerWriterProjection: async () => {
          counts.projections += 1;
          return project();
        },
        reciteContainer: async () => null,
        shareContainer: async () => {
          throw new Error("The status-bearing endpoint must be used");
        },
        shareContainerResult: async (_containerId, request) => {
          counts.submitted += 1;
          return {
            data: await createMutationResponseFromRequest(request),
            ok: true,
          };
        },
      },
      author,
      containerId: parent.projection.containerId,
      execSql: database.execSql,
      recipientUserId,
      resolveProjectionUserKey,
      resolveTrustedUserIdentity: recipients,
      signedAt: SIGNED_AT,
      targetSecretKey: parent.secretKey,
    });
  try {
    // A first share advances and pins the head, as a re-citation would.
    const first = await share("user-2", () => parent.projection);
    if (!first) throw new Error("Expected the first share to commit");
    const successor = await containerWriterProjectionFromSharePlan({
      plan: first.plan,
      previousProjection: parent.projection,
    });
    Object.assign(counts, { evicted: 0, projections: 0, submitted: 0 });
    let served = 0;
    const second = share("user-3", () => {
      served += 1;
      return served === 1
        ? parent.projection
        : refetched({ behind: parent.projection, successor });
    });
    return { counts, second: await second.finally(() => database.close()) };
  } catch (error) {
    database.close();
    throw error;
  }
}

test("a share handed a path behind the local pin is planned again from the successor", async () => {
  const { counts, second } = await shareBehindLocalPin(
    ({ successor }) => successor,
  );
  expect(second).not.toBeNull();
  expect(counts).toEqual({ evicted: 1, projections: 2, submitted: 1 });
});

test("a refetch that rolls the head back still fails the share", async () => {
  await expect(shareBehindLocalPin(({ behind }) => behind)).rejects.toThrow(
    "older than the local checkpoint",
  );
});
