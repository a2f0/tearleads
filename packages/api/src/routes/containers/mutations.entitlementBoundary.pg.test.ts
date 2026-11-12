import { expect, spyOn, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  organizationBilling,
  organizationBillingSeatAssignments,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { and, eq, isNull, sql } from "drizzle-orm";
import { postMutation } from "../../../test/helpers/containerMutationRoutes";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";
import * as persistence from "../../workflows/containers/mutations/shared/persistence";

// A controlled concurrent seat writer, not a membership-policy mutation:
// the latter must also obey the principal/organization lock order. This proves
// the held mutation head locks do not themselves freeze the billing/seat rows.
test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "the mutation boundary sees a concurrent billing-locked seat withdrawal",
  async () => {
    const owner = createTestUser();
    await registerAndAuthenticate(owner);
    const root = await bootstrapRoot(owner);
    const { request, container } = await buildRootContainerRekeyMutation({
      previous: root,
      signer: owner,
    });
    const { containerId, organizationId } = container.bundle.state;
    const headScope = and(
      eq(accessManifestHeads.objectKind, "container"),
      eq(accessManifestHeads.objectId, containerId),
    );
    const seatScope = and(
      eq(organizationBillingSeatAssignments.organizationId, organizationId),
      eq(organizationBillingSeatAssignments.userId, owner.userId),
      isNull(organizationBillingSeatAssignments.releasedAt),
    );
    const before = await db.select().from(accessManifestHeads).where(headScope);
    const persist = persistence.persistVerifiedMutation;
    let withdrew = false;
    const probe = spyOn(
      persistence,
      "persistVerifiedMutation",
    ).mockImplementation(async (...args) => {
      const result = await persist(...args);
      expect(
        (
          await args[0].executor
            .select()
            .from(accessManifestHeads)
            .where(headScope)
        )[0]?.manifestHash,
      ).toBe(request.expectedManifestHash);
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await tx.execute(sql`set local statement_timeout = '3s'`);
        await tx
          .select()
          .from(organizationBilling)
          .where(eq(organizationBilling.organizationId, organizationId))
          .for("update");
        const released = await tx
          .update(organizationBillingSeatAssignments)
          .set({ releasedAt: new Date() })
          .where(seatScope)
          .returning({ id: organizationBillingSeatAssignments.id });
        expect(released).toHaveLength(1);
      });
      withdrew = true;
      return result;
    });
    try {
      const response = await postMutation({
        path: `/containers/${containerId}/rekey`,
        request,
        token: owner.token,
      });
      expect(withdrew).toBe(true);
      expect(response.status, await response.clone().text()).toBe(402);
      expect(await response.json()).toMatchObject({
        reason: "sync_seat_unassigned",
      });
      expect(
        await db.select().from(accessManifestHeads).where(headScope),
      ).toEqual(before);
      // The independent seat transaction committed; only the mutation rolls back.
      expect(
        await db
          .select()
          .from(organizationBillingSeatAssignments)
          .where(seatScope),
      ).toEqual([]);
    } finally {
      probe.mockRestore();
    }
  },
  10_000,
);
