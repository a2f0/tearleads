import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiClient } from "@tearleads/api-client";
import { db } from "@tearleads/api-shared/postgres";
import { principalPolicyCommits } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { bytesToBase64 } from "@tearleads/encoding";
import { isCommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { startPrincipalMutationJournalProcess } from "../../../test/helpers/principalMutationJournalProcess";
import {
  buildOrganizationGroupPolicyCommitRequest,
  createPolicyTestGroup,
  createSignedPrincipalState,
  getDefaultOrganizationId,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { createRequestLifetimeBindings } from "../../middleware/requestLifetime";
import { routeApp } from "../../routeApp";

test("a restarted SDK process recovers its exact disk journal after acknowledgement loss", async () => {
  const actor = createTestUser();
  await registerAndAuthenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const groupId = crypto.randomUUID();
  await createPolicyTestGroup(actor.userId, groupId);
  const signing = {
    principalType: "group" as const,
    principalId: groupId,
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
    members: [{ userId: actor.userId }],
  };
  const request = await buildOrganizationGroupPolicyCommitRequest({
    actor,
    organizationId,
    groupPolicy: await createSignedPrincipalState(signing),
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
  const directory = await mkdtemp(join(tmpdir(), "principal-journal-process-"));
  const input = {
    url: server.url.origin,
    token: actor.token,
    databasePath: join(directory, "journal.sqlite"),
    scope: {
      identityTrustDomain: server.url.origin,
      organizationId,
      userId: actor.userId,
      signingFingerprint: actor.fingerprint,
    },
    publicKey: bytesToBase64(actor.signing.signingPublicKey),
    privateKey: bytesToBase64(actor.signing.signingPrivateKey),
  };
  const initial = startPrincipalMutationJournalProcess({
    ...input,
    mutation: { groupId, request },
  });
  let recovery:
    | ReturnType<typeof startPrincipalMutationJournalProcess>
    | undefined;
  try {
    const first = await Promise.race([
      committed.promise,
      initial.completed.then(() => {
        throw new Error(
          "Initial process received the withheld acknowledgement",
        );
      }),
    ]);
    if (!isCommitOrganizationGroupPolicyResponse(first))
      throw new Error("Missing committed response");
    initial.child.kill("SIGKILL");
    await initial.child.exited;
    release.resolve();
    const disk = new Database(input.databasePath, { readonly: true });
    try {
      expect(
        disk.query("SELECT scope_id FROM principal_mutation_journal").all(),
      ).toHaveLength(1);
    } finally {
      disk.close();
    }

    const secondRequest = await buildOrganizationGroupPolicyCommitRequest({
      actor,
      organizationId,
      groupPolicy: await createSignedPrincipalState({
        ...signing,
        version: 2,
        keyEpoch: 2,
        prevStateHash: first.groupPolicy.currentState.stateHash,
      }),
    });
    const otherDevice = new ApiClient(server.url.origin);
    otherDevice.setAuthToken(actor.token);
    expect(
      (
        await otherDevice.commitOrganizationGroupPolicyResult(
          organizationId,
          groupId,
          secondRequest,
          { signal: AbortSignal.timeout(15_000), reportErrors: false },
        )
      ).ok,
    ).toBe(true);

    // This fresh process receives the restored identity and database path only.
    // Neither the authored request nor the original receipt is supplied to it.
    recovery = startPrincipalMutationJournalProcess(input);
    expect(recovery.child.pid).not.toBe(initial.child.pid);
    expect(await recovery.completed).toEqual(first);
    expect(await recovery.child.exited).toBe(0);
    const recoveredDisk = new Database(input.databasePath, { readonly: true });
    try {
      expect(
        recoveredDisk
          .query("SELECT scope_id FROM principal_mutation_journal")
          .all(),
      ).toHaveLength(0);
    } finally {
      recoveredDisk.close();
    }
    expect(
      (await getCurrentPrincipalState("group", groupId, db))?.version,
    ).toBe(2);
    expect(
      await db
        .select()
        .from(principalPolicyCommits)
        .where(eq(principalPolicyCommits.groupId, groupId)),
    ).toHaveLength(2);
  } finally {
    release.resolve();
    if (initial.child.exitCode === null) initial.child.kill("SIGKILL");
    if (recovery?.child.exitCode === null) recovery.child.kill("SIGKILL");
    await Promise.all([initial.child.exited, recovery?.child.exited]);
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
