import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerRotationRequest } from "@tearleads/validators/request";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { createRotatedAncestorFixture } from "../../../../../test/helpers/ancestorRotationRecovery";
import { createRecipientIdentityResolver } from "../../../../../test/helpers/containerFixtures";
import { createContainerServer } from "../../../../../test/helpers/containerMutationServer";
import { loadAccessManifestCheckpoint } from "../../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { revokeRemoteContainer } from "../revoke";
import { shareRemoteContainer } from "../share";

async function fixture(carry = false) {
  const chain = await createRotatedAncestorFixture();
  const database = await createTestExecSql("revoke-cached-path");
  const rootId = chain.root.projection.containerId;
  const server = createContainerServer(
    [
      chain.root.projection,
      chain.child.projection,
      chain.grandchild.projection,
    ],
    carry ? { [rootId]: ["child"] } : {},
  );
  const recipient = generateKemSeedAndKeyPair();
  const signing = generateSigningSeedAndKeyPair();
  const identity = createRecipientIdentityResolver({
    encapsulationPublicKey: recipient.publicKey,
    signingPublicKey: signing.signingPublicKey,
    signingKeyFingerprint: await toFingerprint(signing.signingPublicKey),
  });
  const input = {
    ...chain.input,
    execSql: database.execSql,
    persistVerificationCheckpoints: undefined,
    containerId: rootId,
    reportSecurityIncident: async () => {},
    resolveProjectionUserKey: (userId: string) =>
      userId === "recipient"
        ? identity(userId)
        : chain.input.resolveProjectionUserKey(userId),
  };
  try {
    const shared = await shareRemoteContainer({
      ...input,
      apiClient: server.apiClient,
      accessLevel: "write",
      recipientUserId: "recipient",
      resolveTrustedUserIdentity: identity,
    });
    if (!shared) throw new Error("Expected committed grant");
    const successor = server.project(rootId);
    if (!successor) throw new Error("Expected successor projection");
    server.submissions.length = 0;
    return { database, server, chain, input, successor };
  } catch (error) {
    database.close();
    throw error;
  }
}

test.each([false, true])(
  "a cached path behind the revoke pin is refetched; repeated rollback still fails (%j)",
  async (repeatRollback) => {
    const { database, server, chain, input, successor } = await fixture();
    const counts = { projections: 0, evicted: 0 };
    try {
      const revoke = revokeRemoteContainer({
        ...input,
        revokedSubject: { subjectType: "user", subjectId: "recipient" },
        apiClient: {
          ...server.apiClient,
          getContainerWriterProjection: async () => {
            counts.projections += 1;
            return counts.projections === 1 || repeatRollback
              ? chain.root.projection
              : successor;
          },
          evictContainerWriterProjection: () => {
            counts.evicted += 1;
          },
          revokeContainer: server.apiClient.rekeyContainer,
          revokeContainerResult: server.apiClient.rekeyContainerResult,
        },
      });
      if (repeatRollback) {
        await expect(revoke).rejects.toThrow("older than the local checkpoint");
        expect(server.submissions).toEqual([]);
      } else {
        expect(await revoke).not.toBeNull();
        expect(server.submissions).toEqual([[input.containerId]]);
      }
      expect(counts).toEqual({ projections: 2, evicted: 1 });
    } finally {
      database.close();
    }
  },
);

test("a stale refusal after carrying descendants rebuilds and pins the entire revoke batch", async () => {
  const { database, server, input } = await fixture(true);
  const submitted: ContainerRotationRequest[] = [];
  let evicted = 0;
  try {
    const revoked = await revokeRemoteContainer({
      ...input,
      revokedSubject: { subjectType: "user", subjectId: "recipient" },
      apiClient: {
        ...server.apiClient,
        evictContainerWriterProjection: () => {
          evicted += 1;
        },
        revokeContainer: server.apiClient.rekeyContainer,
        revokeContainerResult: async (id, request) => {
          submitted.push(request);
          if (submitted.length === 2)
            return {
              ok: false,
              status: 409,
              code: CONTAINER_MUTATION_ERROR_CODES.stateStale,
              report: () => {
                throw new Error("Recoverable refusal must not be reported");
              },
            };
          return server.apiClient.rekeyContainerResult(id, request);
        },
      },
    });
    expect(revoked).not.toBeNull();
    expect(evicted).toBe(1);
    expect(
      submitted.map((request) => request.containerRekeys?.length ?? 0),
    ).toEqual([0, 1, 0, 1]);
    expect(submitted[0]?.expectedManifestHash).toBe(
      submitted[1]?.expectedManifestHash,
    );
    expect(submitted[2]?.expectedManifestHash).toBe(
      submitted[3]?.expectedManifestHash,
    );
    expect(submitted[0]?.expectedManifestHash).not.toBe(
      submitted[2]?.expectedManifestHash,
    );
    expect(submitted[1]?.containerRekeys?.[0]?.expectedManifestHash).not.toBe(
      submitted[3]?.containerRekeys?.[0]?.expectedManifestHash,
    );
    const child = server.project("child");
    expect(child?.containerKeks.at(-1)?.parentContainerKeyEpochId).toBe(
      revoked?.plan.containerKeyEpochId,
    );
    const pinned = await loadAccessManifestCheckpoint(
      database.execSql,
      "container",
      input.author.organizationId,
      "child",
    );
    expect(pinned?.manifestHash).toBe(child?.path.at(-1)?.manifestHash);
  } finally {
    database.close();
  }
});
