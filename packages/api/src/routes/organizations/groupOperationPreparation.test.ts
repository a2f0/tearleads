import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  groups,
  principalHistoryIndexNodes,
  principalHistoryProgress,
  principalPolicyCommits,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { clearPrincipalPolicySignatureCaches } from "@tearleads/crypto/principal-policy-test-fixtures";
import { putPrincipalPolicyOperation } from "@tearleads/validators/operation";
import { PrincipalPolicyBundleResponseSchema } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { seedLongPrincipalHistory } from "../../../test/helpers/longPrincipalHistory";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import {
  buildOrganizationGroupDeletionRequest,
  getDefaultOrganizationId,
} from "../../../test/helpers/principalPolicy";
import {
  getPolicy,
  registerAndAuthenticate,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { clearStoredPolicySnapshotCache } from "../../../test/helpers/principalSnapshotVerificationCache";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";
import { schedulePrincipalHistoryPreparation } from "../../workflows/principals/principalHistoryScheduler";
import { clearProjectionDirectoryBindingsCache } from "../../workflows/principals/projectionDirectoryBindings";

test.each(["creation", "deletion"] as const)(
  "group %s rolls back while preparing a cold long directory",
  async (operation) => {
    const actor = createTestUser();
    await registerAndAuthenticate(actor);
    const organizationId = await getDefaultOrganizationId(actor.userId);
    const groupId = crypto.randomUUID();
    const path = `/organizations/${organizationId}/groups`;
    const headers = {
      Authorization: `Bearer ${actor.token}`,
      "Content-Type": "application/json",
    };
    if (operation === "deletion") {
      const created = await routeApp.request(path, {
        method: "POST",
        headers,
        body: JSON.stringify(
          await createGroupRequest({ actor, groupId, name: "Delete later" }),
        ),
      });
      expect(created.status).toBe(200);
      await created.arrayBuffer();
    }
    const policy = PrincipalPolicyBundleResponseSchema.parse(
      await (await getPolicy(actor, "organization", organizationId)).json(),
    );
    await seedLongPrincipalHistory({ actor, policy, throughVersion: 65 });
    const request =
      operation === "creation"
        ? await createGroupRequest({ actor, groupId, name: "Prepared group" })
        : await buildOrganizationGroupDeletionRequest({
            actor,
            groupId,
            organizationId,
          });
    const body = JSON.stringify(request);
    await db.delete(principalHistoryProgress);
    await db.delete(principalHistoryIndexNodes);
    clearPrincipalPolicySignatureCaches();
    clearStoredPolicySnapshotCache();
    clearProjectionDirectoryBindingsCache();
    const before = await getCurrentPrincipalState(
      "organization",
      organizationId,
      db,
    );
    if (!before) throw new Error("Missing seeded directory");
    const gate = Promise.withResolvers<void>();
    const waiting = Array.from({ length: 66 }, (_, index) =>
      schedulePrincipalHistoryPreparation(
        db,
        { ...before, principalId: crypto.randomUUID() },
        () => (index < 2 ? gate.promise : Promise.resolve()),
      ).catch((error: unknown) => error),
    );
    try {
      const busy = await routeApp.request(
        operation === "creation" ? path : `${path}/${groupId}`,
        { method: operation === "creation" ? "POST" : "DELETE", headers, body },
      );
      expect(busy.status).toBe(503);
      expect(await busy.json()).toEqual({
        error: "Principal history preparation is busy; retry later",
        code: "principal_history_preparation_unavailable",
        committed: false,
      });
      expect(
        await getCurrentPrincipalState("organization", organizationId, db),
      ).toEqual(before);
    } finally {
      gate.resolve();
      await Promise.all(waiting);
    }
    const progress = new Set<string>();
    const receiptsBefore = await db.select().from(principalPolicyCommits);
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await routeApp.request(
        operation === "creation" ? path : `${path}/${groupId}`,
        { method: operation === "creation" ? "POST" : "DELETE", headers, body },
      );
      if (response.status === 202) {
        const pending = putPrincipalPolicyOperation.responses[202].parse(
          await response.json(),
        );
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(pending.committed).toBe(false);
        expect(progress.has(pending.progressToken)).toBe(false);
        progress.add(pending.progressToken);
        expect(
          (await getCurrentPrincipalState("organization", organizationId, db))
            ?.version,
        ).toBe(65);
        expect(await db.select().from(principalPolicyCommits)).toEqual(
          receiptsBefore,
        );
        expect(
          await db.select().from(groups).where(eq(groups.id, groupId)),
        ).toHaveLength(operation === "creation" ? 0 : 1);
        continue;
      }
      expect(response.status, await response.clone().text()).toBe(200);
      await response.arrayBuffer();
      expect(progress.size).toBeGreaterThan(0);
      expect(
        (await getCurrentPrincipalState("organization", organizationId, db))
          ?.version,
      ).toBe(66);
      expect(
        await db.select().from(groups).where(eq(groups.id, groupId)),
      ).toHaveLength(operation === "creation" ? 1 : 0);
      return;
    }
    throw new Error("Group operation preparation failed to converge");
  },
  30_000,
);
