import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { ContainerRotationRequest } from "@tearleads/validators/request";
import {
  CONTAINER_MUTATION_ERROR_CODES,
  encodeContainerWriterProjection,
} from "@tearleads/validators/response";
import { createRotatedAncestorFixture } from "../../../../../test/helpers/ancestorRotationRecovery";
import { createRecipientIdentityResolver } from "../../../../../test/helpers/containerFixtures";
import { createContainerServer } from "../../../../../test/helpers/containerMutationServer";
import { loadAccessManifestCheckpoint } from "../../../../data/persistence/keyingCheckpoints/keyingCheckpointPersistence";
import { rekeyRemoteContainer } from "../rekey/rekeyRemote";
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

test.each(["submission", "planning"] as const)(
  "a stale descendant during %s rebuilds and pins the entire revoke batch",
  async (phase) => {
    const { database, server, input } = await fixture(true);
    const submitted: ContainerRotationRequest[] = [];
    let evicted = 0;
    let reported = 0;
    let childFetches = 0;
    const otherDatabase = await createTestExecSql("concurrent-child-rotation");
    const http = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        const id = new URL(request.url).pathname.split("/")[2] ?? "";
        if (id === "child") childFetches += 1;
        const projection = server.project(id);
        return projection
          ? Response.json(encodeContainerWriterProjection(projection))
          : new Response(null, { status: 404 });
      },
    });
    const cached = new ApiClient(http.url.origin);
    try {
      if (phase === "planning") {
        await cached.getContainerWriterProjection("child");
        // A verified rotation advances our pin while an older child remains in
        // the API cache, as another projection-verifying workflow can do.
        expect(
          await rekeyRemoteContainer({
            ...input,
            apiClient: server.apiClient,
            containerId: "child",
          }),
        ).not.toBeNull();
      }
      const revoked = await revokeRemoteContainer({
        ...input,
        revokedSubject: { subjectType: "user", subjectId: "recipient" },
        apiClient: {
          ...server.apiClient,
          getContainerWriterProjection: (id) =>
            cached.getContainerWriterProjection(id),
          evictContainerWriterProjection: (id) => {
            evicted += 1;
            cached.evictContainerWriterProjection(id);
          },
          evictWriterProjectionsCiting: (ids: readonly string[]) =>
            cached.evictWriterProjectionsCiting(ids),
          revokeContainer: server.apiClient.rekeyContainer,
          revokeContainerResult: async (id, request) => {
            submitted.push(request);
            if (phase === "submission" && submitted.length === 2) {
              // Another device rotates the descendant after this client cached
              // it and signed the carry, while the parent is still current.
              const rotated = await rekeyRemoteContainer({
                ...input,
                execSql: otherDatabase.execSql,
                apiClient: server.apiClient,
                containerId: "child",
              });
              expect(rotated).not.toBeNull();
            }
            const carried = request.containerRekeys?.[0];
            if (
              carried &&
              carried.previousManifestRef?.manifestHash !==
                server.project("child")?.path.at(-1)?.manifestHash
            )
              return {
                ok: false,
                status: 409,
                code: CONTAINER_MUTATION_ERROR_CODES.stateStale,
                report: () => {
                  reported += 1;
                },
              };
            return server.apiClient.rekeyContainerResult(id, request);
          },
        },
      });
      expect(revoked).not.toBeNull();
      expect(evicted).toBe(1);
      expect(reported).toBe(0);
      expect(childFetches).toBe(2);
      expect(
        submitted.map((request) => request.containerRekeys?.length ?? 0),
      ).toEqual(phase === "submission" ? [0, 1, 0, 1] : [0, 0, 1]);
      const retryStart = phase === "submission" ? 2 : 1;
      expect(submitted[retryStart]?.expectedManifestHash).toBe(
        submitted.at(-1)?.expectedManifestHash,
      );
      expect(submitted[0]?.expectedManifestHash).not.toBe(
        submitted[retryStart]?.expectedManifestHash,
      );
      if (phase === "submission") {
        expect(submitted[0]?.expectedManifestHash).toBe(
          submitted[1]?.expectedManifestHash,
        );
        expect(
          submitted[1]?.containerRekeys?.[0]?.expectedManifestHash,
        ).not.toBe(submitted[3]?.containerRekeys?.[0]?.expectedManifestHash);
      }
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
      await http.stop(true);
      otherDatabase.close();
      database.close();
    }
  },
);

test("an acknowledgement rollback after acceptance never replans the revoke", async () => {
  const { database, server, input } = await fixture();
  let evicted = 0;
  let revokes = 0;
  let advanced = false;
  try {
    await expect(
      revokeRemoteContainer({
        ...input,
        revokedSubject: { subjectType: "user", subjectId: "recipient" },
        apiClient: {
          ...server.apiClient,
          evictContainerWriterProjection: () => {
            evicted += 1;
          },
          revokeContainer: server.apiClient.rekeyContainer,
          revokeContainerResult: async (id, request) => {
            revokes += 1;
            const result = await server.apiClient.rekeyContainerResult(
              id,
              request,
            );
            if (result.ok && !advanced) {
              advanced = true;
              // The revoke committed, but another verified rotation advances our
              // pin before its response reaches acknowledgement.
              expect(
                await rekeyRemoteContainer({
                  ...input,
                  apiClient: server.apiClient,
                }),
              ).not.toBeNull();
            }
            return result;
          },
        },
      }),
    ).rejects.toMatchObject({ code: "rollback" });
    expect(advanced).toBe(true);
    expect(revokes).toBe(1);
    expect(evicted).toBe(0);
    expect(server.submissions).toEqual([
      [input.containerId],
      [input.containerId],
    ]);
  } finally {
    database.close();
  }
});
