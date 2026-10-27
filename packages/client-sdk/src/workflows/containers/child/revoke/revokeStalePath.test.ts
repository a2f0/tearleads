import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  createRecipientIdentityResolver,
} from "../../../../../test/helpers/containerFixtures";
import { revokeRemoteContainer } from "../revoke";

type Refusal = { readonly status: number; readonly code?: string };
const STALE: Refusal = {
  status: 409,
  code: CONTAINER_MUTATION_ERROR_CODES.stateStale,
};

async function revokeAgainst(
  refusals: readonly Refusal[],
  cancelOnRefusal = false,
) {
  const recipient = generateKemSeedAndKeyPair();
  const signing = generateSigningSeedAndKeyPair();
  const parent = await createParentProjection({
    existingUserRecipient: {
      accessLevel: "write",
      publicKey: recipient.publicKey,
      recipientKeyEpochId: `user:recipient:encapsulation:${await toFingerprint(recipient.publicKey)}`,
      userId: "recipient",
    },
  });
  const resolveRecipient = createRecipientIdentityResolver({
    encapsulationPublicKey: recipient.publicKey,
    signingKeyFingerprint: await toFingerprint(signing.signingPublicKey),
    signingPublicKey: signing.signingPublicKey,
  });
  const database = await createTestExecSql("revoke-stale-path");
  const submitted: ContainerMutationRequest[] = [];
  const counts = { evicted: 0, projections: 0, reported: 0 };
  let current = true;
  try {
    const revoked = await revokeRemoteContainer({
      reportSecurityIncident: async () => {},
      apiClient: {
        evictContainerWriterProjection: () => {
          counts.evicted += 1;
        },
        getContainerWriterProjection: async () => {
          counts.projections += 1;
          return parent.projection;
        },
        reciteContainer: async () => null,
        revokeContainer: async () => {
          throw new Error("Expected status-bearing endpoint");
        },
        revokeContainerResult: async (_id, request) => {
          const refusal = refusals[submitted.length];
          submitted.push(request);
          if (!refusal)
            return {
              ok: true,
              data: await createMutationResponseFromRequest(
                request,
                parent.projection,
              ),
            };
          if (cancelOnRefusal) current = false;
          return {
            ...refusal,
            ok: false,
            report: () => {
              counts.reported += 1;
            },
          };
        },
      },
      author: parent.author,
      containerId: parent.projection.containerId,
      execSql: database.execSql,
      revokedSubject: { subjectType: "user", subjectId: "recipient" },
      resolveProjectionUserKey: (userId) =>
        userId === "recipient"
          ? resolveRecipient(userId)
          : createParentProjectionUserKeyResolver(parent)(userId),
      stillCurrent: () => current,
      targetSecretKey: parent.secretKey,
    });
    return { revoked, submitted, counts };
  } finally {
    database.close();
  }
}

test("a stale revoke evicts, replans, and acknowledges a new rotation", async () => {
  const { revoked, submitted, counts } = await revokeAgainst([STALE]);
  expect(revoked).not.toBeNull();
  expect(submitted).toHaveLength(2);
  expect(submitted[1]?.expectedManifestHash).not.toBe(
    submitted[0]?.expectedManifestHash,
  );
  expect(counts).toEqual({ evicted: 1, projections: 2, reported: 0 });
});

test("a second stale revoke is terminal and reports once", async () => {
  const { revoked, submitted, counts } = await revokeAgainst([STALE, STALE]);
  expect(revoked).toBeNull();
  expect(submitted).toHaveLength(2);
  expect(counts).toEqual({ evicted: 1, projections: 2, reported: 1 });
});

test.each([
  { status: 403 },
  { status: 409 },
  { status: 400, code: CONTAINER_MUTATION_ERROR_CODES.stateStale },
] as const)("a non-stale revoke refusal is terminal (%j)", async (refusal) => {
  const { revoked, submitted, counts } = await revokeAgainst([refusal]);
  expect(revoked).toBeNull();
  expect(submitted).toHaveLength(1);
  expect(counts).toEqual({ evicted: 0, projections: 1, reported: 1 });
});

test("a canceled revoke does not retry its stale refusal", async () => {
  const { revoked, submitted, counts } = await revokeAgainst([STALE], true);
  expect(revoked).toBeNull();
  expect(submitted).toHaveLength(1);
  expect(counts).toEqual({ evicted: 0, projections: 1, reported: 0 });
});
