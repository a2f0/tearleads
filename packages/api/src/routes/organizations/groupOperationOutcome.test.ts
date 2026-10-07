import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationReadModelHeads,
  principalPolicyCommits,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  CreateOrganizationGroupWithPolicyRequestSchema,
  DeleteOrganizationGroupRequestSchema,
} from "@tearleads/validators/request";
import {
  isCreateOrganizationGroupResponse,
  isDeleteOrganizationGroupResponse,
} from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import {
  buildOrganizationGroupDeletionRequest,
  getDefaultOrganizationId,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { createRequestLifetimeBindings } from "../../middleware/requestLifetime";
import { routeApp } from "../../routeApp";

test.each(["creation", "deletion"] as const)(
  "a lost group %s acknowledgement replays exactly after a later directory write",
  async (operation) => {
    const actor = createTestUser();
    await registerAndAuthenticate(actor);
    const organizationId = await getDefaultOrganizationId(actor.userId);
    const groupId = crypto.randomUUID();
    const path = `/organizations/${organizationId}/groups`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${actor.token}`,
    };
    const createdRequest = await createGroupRequest({
      actor,
      groupId,
      name: "Uncertain group",
    });
    if (operation === "deletion") {
      const created = await routeApp.request(path, {
        method: "POST",
        headers,
        body: JSON.stringify(createdRequest),
      });
      expect(created.status).toBe(200);
      await created.arrayBuffer();
    }
    const request =
      operation === "creation"
        ? createdRequest
        : await buildOrganizationGroupDeletionRequest({
            actor,
            groupId,
            organizationId,
          });
    const body = JSON.stringify(request);
    const target = operation === "creation" ? path : `${path}/${groupId}`;
    const method = operation === "creation" ? "POST" : "DELETE";
    const committed = Promise.withResolvers<unknown>();
    const release = Promise.withResolvers<void>();
    let hold = true;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request, listener) {
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
    const controller = new AbortController();
    const submit = (signal: AbortSignal) =>
      fetch(new URL(target, server.url), { method, headers, body, signal });
    try {
      const interrupted = submit(controller.signal).catch(
        (error: unknown) => error,
      );
      const first = await Promise.race([
        committed.promise,
        interrupted.then(() => {
          throw new Error("Request ended before the group commit barrier");
        }),
      ]);
      expect(
        operation === "creation"
          ? isCreateOrganizationGroupResponse(first)
          : isDeleteOrganizationGroupResponse(first),
      ).toBe(true);
      controller.abort();
      expect(await interrupted).toBeInstanceOf(Error);
      release.resolve();
      const next = await routeApp.request(path, {
        method: "POST",
        headers,
        body: JSON.stringify(
          await createGroupRequest({
            actor,
            groupId: crypto.randomUUID(),
            name: "Later group",
          }),
        ),
      });
      expect(next.status).toBe(200);
      await next.arrayBuffer();
      const before = await getCurrentPrincipalState(
        "organization",
        organizationId,
        db,
      );
      const cursorBefore = await db
        .select()
        .from(organizationReadModelHeads)
        .where(eq(organizationReadModelHeads.organizationId, organizationId));
      for (const response of await Promise.all([
        submit(AbortSignal.timeout(15_000)),
        submit(AbortSignal.timeout(15_000)),
      ])) {
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(first);
      }
      expect(
        await getCurrentPrincipalState("organization", organizationId, db),
      ).toEqual(before);
      expect(
        await db
          .select()
          .from(organizationReadModelHeads)
          .where(eq(organizationReadModelHeads.organizationId, organizationId)),
      ).toEqual(cursorBefore);
      const substituted = structuredClone(request);
      substituted.organizationPolicy.encryptedPayload.ciphertext = "AAAA";
      expect(
        (operation === "creation"
          ? CreateOrganizationGroupWithPolicyRequestSchema
          : DeleteOrganizationGroupRequestSchema
        ).safeParse(substituted).success,
      ).toBe(true);
      const altered = await fetch(new URL(target, server.url), {
        method,
        headers,
        body: JSON.stringify(substituted),
      });
      // A changed deletion request has no receipt and its target is gone.
      expect([400, 404, 409]).toContain(altered.status);
      await altered.arrayBuffer();
      const outsider = createTestUser();
      await registerAndAuthenticate(outsider);
      const foreign = await fetch(new URL(target, server.url), {
        method,
        headers: { ...headers, Authorization: `Bearer ${outsider.token}` },
        body,
      });
      expect(foreign.status).toBe(403);
      await foreign.arrayBuffer();
      if (operation === "deletion") {
        const changedTarget = await fetch(
          new URL(`${path}/${crypto.randomUUID()}`, server.url),
          { method, headers, body },
        );
        expect(changedTarget.status).toBe(404);
        await changedTarget.arrayBuffer();
      }
      const [receipt] = await db
        .select()
        .from(principalPolicyCommits)
        .where(
          and(
            eq(principalPolicyCommits.organizationId, organizationId),
            operation === "creation"
              ? eq(principalPolicyCommits.groupId, groupId)
              : isNull(principalPolicyCommits.groupId),
          ),
        );
      if (!receipt) throw new Error("Missing group operation receipt");
      expect(receipt.responseJson.length).toBeLessThan(1_024);
      expect(receipt.responseJson).not.toContain(
        request.organizationPolicy.encryptedPayload.ciphertext,
      );
      for (const envelope of request.organizationPolicy.memberEnvelopes)
        expect(receipt.responseJson).not.toContain(envelope.wrappedKey);
      await db
        .update(principalPolicyCommits)
        .set({ responseJson: "null" })
        .where(eq(principalPolicyCommits.requestHash, receipt.requestHash));
      const corrupt = await submit(AbortSignal.timeout(15_000));
      expect(corrupt.status).toBe(409);
      await corrupt.arrayBuffer();
    } finally {
      controller.abort();
      release.resolve();
      await server.stop(true);
    }
  },
  30_000,
);
