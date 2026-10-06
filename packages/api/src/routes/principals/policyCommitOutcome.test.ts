import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalPolicyCommits } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { CommitOrganizationGroupPolicyRequestSchema } from "@tearleads/validators/request";
import { isCommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  createPolicyTestGroup,
  createSignedPrincipalState,
  getDefaultOrganizationId,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { createRequestLifetimeBindings } from "../../middleware/requestLifetime";
import { routeApp } from "../../routeApp";
import { deleteOrganizationGroupRows } from "../../workflows/organizations/groupDeletion";

test("a lost compound commit response remains recoverable after a later policy update", async () => {
  const actor = createTestUser();
  await registerAndAuthenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const groupId = crypto.randomUUID();
  await createPolicyTestGroup(actor.userId, groupId);
  const initial = await createSignedPrincipalState({
    principalType: "group",
    principalId: groupId,
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
    members: [{ userId: actor.userId }],
  });
  const committed = Promise.withResolvers<unknown>();
  const release = Promise.withResolvers<void>();
  let holdResponse = true;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server) {
      const response = await routeApp.fetch(
        request,
        createRequestLifetimeBindings(request, server),
      );
      if (response.status === 200 && holdResponse) {
        holdResponse = false;
        committed.resolve(await response.clone().json());
        await release.promise;
      }
      return response;
    },
  });
  const controller = new AbortController();
  let originalRequest: { path: string; init: RequestInit } | undefined;
  const transport = async (path: string, init: RequestInit) => {
    while (true) {
      const response = await fetch(new URL(path, server.url), {
        ...init,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status !== 202) return response;
      await response.arrayBuffer();
    }
  };
  try {
    const interrupted = submitOrganizationGroupPolicyCommit({
      actor,
      groupId,
      groupPolicy: initial,
      organizationId,
      request: async (path, init) => {
        originalRequest = { path, init };
        return fetch(new URL(path, server.url), {
          ...init,
          signal: controller.signal,
        });
      },
    }).catch((error: unknown) => error);
    const first = await Promise.race([
      committed.promise,
      interrupted.then(() => {
        throw new Error("Initial request ended before the commit barrier");
      }),
    ]);
    if (!isCommitOrganizationGroupPolicyResponse(first))
      throw new Error("Missing committed response");
    controller.abort();
    expect(await interrupted).toBeInstanceOf(Error);
    release.resolve();
    const second = await createSignedPrincipalState({
      principalType: "group",
      principalId: groupId,
      signerUserId: actor.userId,
      signerUserKeyFingerprint: actor.fingerprint,
      signingPrivateKey: actor.signing.signingPrivateKey,
      members: [{ userId: actor.userId }],
      version: 2,
      keyEpoch: 2,
      prevStateHash: first.groupPolicy.currentState.stateHash,
    });
    const next = await submitOrganizationGroupPolicyCommit({
      actor,
      groupId,
      groupPolicy: second,
      organizationId,
      request: transport,
    });
    expect(next.status).toBe(200);
    await next.arrayBuffer();
    if (!originalRequest) throw new Error("Missing exact original request");
    const replays = await Promise.all([
      transport(originalRequest.path, originalRequest.init),
      transport(originalRequest.path, originalRequest.init),
    ]);
    for (const replay of replays) {
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual(first);
    }
    if (typeof originalRequest.init.body !== "string")
      throw new Error("Missing request bytes");
    const changed = CommitOrganizationGroupPolicyRequestSchema.parse(
      JSON.parse(originalRequest.init.body),
    );
    changed.groupPolicy.encryptedPayload.ciphertext = "AAAA";
    const substituted = await transport(originalRequest.path, {
      ...originalRequest.init,
      body: JSON.stringify(changed),
    });
    expect(
      CommitOrganizationGroupPolicyRequestSchema.safeParse(changed).success,
    ).toBe(true);
    expect([400, 409]).toContain(substituted.status);
    await substituted.arrayBuffer();
    const other = createTestUser();
    await registerAndAuthenticate(other);
    const foreign = await transport(originalRequest.path, {
      ...originalRequest.init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${other.token}`,
      },
    });
    expect(foreign.status).toBe(403);
    await foreign.arrayBuffer();

    expect(
      (await getCurrentPrincipalState("group", groupId, db))?.version,
    ).toBe(2);
    expect(
      (await getCurrentPrincipalState("organization", organizationId, db))
        ?.version,
    ).toBe(first.organizationPolicy.currentState.version + 1);
    expect(
      await db
        .select()
        .from(principalPolicyCommits)
        .where(eq(principalPolicyCommits.groupId, groupId)),
    ).toHaveLength(2);
    const [receipt] = await db
      .select()
      .from(principalPolicyCommits)
      .where(eq(principalPolicyCommits.groupId, groupId));
    if (!receipt) throw new Error("Missing committed receipt");
    // Corruption is never treated as a cache miss that reapplies an old write.
    for (const responseJson of ["{", JSON.stringify({})]) {
      await db
        .update(principalPolicyCommits)
        .set({ responseJson })
        .where(eq(principalPolicyCommits.groupId, groupId));
      const corrupt = await transport(
        originalRequest.path,
        originalRequest.init,
      );
      expect(corrupt.status).toBe(409);
      await corrupt.arrayBuffer();
    }
    await deleteOrganizationGroupRows({
      executor: db,
      organizationId,
      groupId,
    });
    expect(
      await db
        .select()
        .from(principalPolicyCommits)
        .where(eq(principalPolicyCommits.groupId, groupId)),
    ).toEqual([]);
  } finally {
    controller.abort();
    release.resolve();
    await server.stop(true);
  }
}, 20_000);
