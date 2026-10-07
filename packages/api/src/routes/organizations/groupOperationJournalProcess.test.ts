import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { AuthoredPrincipalMutation } from "@tearleads/client-sdk";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  isCreateOrganizationGroupResponse,
  isDeleteOrganizationGroupResponse,
  isPrincipalPolicyMutationResponse,
} from "@tearleads/validators/response";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { prepareOrganizationPolicyAdvance } from "../../../test/helpers/organizationPolicyOutcome";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import { startPrincipalMutationJournalProcess } from "../../../test/helpers/principalMutationJournalProcess";
import {
  buildOrganizationGroupDeletionRequest,
  getDefaultOrganizationId,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { createRequestLifetimeBindings } from "../../middleware/requestLifetime";
import { routeApp } from "../../routeApp";

test.each(["group-create", "group-delete", "organization"] as const)(
  "a restarted SDK process recovers a committed %s from its disk journal",
  async (kind) => {
    const actor = createTestUser();
    await registerAndAuthenticate(actor);
    const organizationId = await getDefaultOrganizationId(actor.userId);
    const groupId = crypto.randomUUID();
    const path = `/organizations/${organizationId}/groups`;
    const headers = {
      Authorization: `Bearer ${actor.token}`,
      "Content-Type": "application/json",
    };
    const creation = await createGroupRequest({
      actor,
      groupId,
      name: "Durable group",
    });
    if (kind === "group-delete") {
      const created = await requestPreparedPrincipalPolicy(path, {
        method: "POST",
        headers,
        body: JSON.stringify(creation),
      });
      expect(created.status).toBe(200);
      await created.arrayBuffer();
    }
    const mutation: AuthoredPrincipalMutation =
      kind === "group-create"
        ? { kind, groupId, request: creation }
        : kind === "group-delete"
          ? {
              kind,
              groupId,
              request: await buildOrganizationGroupDeletionRequest({
                actor,
                groupId,
                organizationId,
              }),
            }
          : {
              kind,
              groupId: null,
              request: (
                await prepareOrganizationPolicyAdvance(actor, organizationId)
              ).body,
            };
    const committed = Promise.withResolvers<unknown>();
    const release = Promise.withResolvers<void>();
    let hold = true;
    const bodies: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request, listener) {
        bodies.push(await request.clone().text());
        const response = await routeApp.fetch(
          request,
          createRequestLifetimeBindings(request, listener),
        );
        if (hold && response.status === 200) {
          hold = false;
          committed.resolve(await response.clone().json());
          await release.promise;
        }
        return response;
      },
    });
    const directory = await mkdtemp(
      join(tmpdir(), "principal-lifecycle-process-"),
    );
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
      mutation,
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
      if (
        !isCreateOrganizationGroupResponse(first) &&
        !isDeleteOrganizationGroupResponse(first) &&
        !isPrincipalPolicyMutationResponse(first)
      )
        throw new Error("Missing committed principal outcome");
      initial.child.kill("SIGKILL");
      await initial.child.exited;
      release.resolve();
      expect(journalRows(input.databasePath)).toBe(1);
      const later = await requestPreparedPrincipalPolicy(path, {
        method: "POST",
        headers,
        body: JSON.stringify(
          await createGroupRequest({
            actor,
            groupId: crypto.randomUUID(),
            name: "Later directory",
          }),
        ),
      });
      expect(later.status).toBe(200);
      await later.arrayBuffer();
      const before = await getCurrentPrincipalState(
        "organization",
        organizationId,
        db,
      );
      // Only identity and the durable database are supplied to the new process.
      recovery = startPrincipalMutationJournalProcess(input);
      expect(recovery.child.pid).not.toBe(initial.child.pid);
      expect(await recovery.completed).toEqual(first);
      expect(await recovery.child.exited).toBe(0);
      expect(journalRows(input.databasePath)).toBe(0);
      expect(
        await getCurrentPrincipalState("organization", organizationId, db),
      ).toEqual(before);
      expect(bodies.length).toBeGreaterThanOrEqual(2);
      const original = bodies[0];
      if (original === undefined) throw new Error("Missing initial request");
      for (const body of bodies) expect(body).toBe(original);
    } finally {
      release.resolve();
      if (initial.child.exitCode === null) initial.child.kill("SIGKILL");
      if (recovery?.child.exitCode === null) recovery.child.kill("SIGKILL");
      await Promise.all([initial.child.exited, recovery?.child.exited]);
      await server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);

function journalRows(path: string): number {
  const disk = new Database(path, { readonly: true });
  try {
    return disk.query("SELECT scope_id FROM principal_mutation_journal").all()
      .length;
  } finally {
    disk.close();
  }
}
