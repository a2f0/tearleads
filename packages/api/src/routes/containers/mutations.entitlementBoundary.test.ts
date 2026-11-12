import { expect, setSystemTime, spyOn, test } from "bun:test";
import { type DatabaseSession, db } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  accessManifests,
  organizationBilling,
  organizationBillingSeatAssignments,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { and, eq, isNull } from "drizzle-orm";
import { postMutation } from "../../../test/helpers/containerMutationRoutes";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { registerAndAuthenticate } from "../../../test/helpers/registerUser";
import * as persistence from "../../workflows/containers/mutations/shared/persistence";

const ADMITTED_AT = new Date("2030-01-01T00:00:00.000Z");
const EXPIRES_AT = new Date("2030-01-01T00:00:01.000Z");

function readHead(executor: DatabaseSession, containerId: string) {
  return executor
    .select()
    .from(accessManifestHeads)
    .where(
      and(
        eq(accessManifestHeads.objectKind, "container"),
        eq(accessManifestHeads.objectId, containerId),
      ),
    );
}

async function scenario(status: "trialing" | "active") {
  // Do not move the clock backwards after registration's trial timestamps.
  setSystemTime(ADMITTED_AT);
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const { request, container } = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const child = {
    containerId: container.bundle.state.containerId,
    organizationId: container.bundle.state.organizationId,
  };
  await db
    .update(organizationBilling)
    .set({
      status,
      trialEndsAt: status === "trialing" ? EXPIRES_AT : null,
      currentPeriodStartsAt: status === "active" ? ADMITTED_AT : null,
      currentPeriodEndsAt: status === "active" ? EXPIRES_AT : null,
    })
    .where(eq(organizationBilling.organizationId, child.organizationId));
  return { owner, child, request };
}

for (const status of ["trialing", "active"] as const) {
  for (const boundary of [
    { name: "before", now: ADMITTED_AT, responseStatus: 200 },
    { name: "at", now: EXPIRES_AT, responseStatus: 402 },
    {
      name: "after",
      now: new Date("2030-01-01T00:00:01.001Z"),
      responseStatus: 402,
    },
  ]) {
    test(`${status} mutation reaching the public boundary ${boundary.name} expiry`, async () => {
      const persist = persistence.persistVerifiedMutation;
      let restore = () => {};
      try {
        const { owner, child, request } = await scenario(status);
        const before = await readHead(db, child.containerId);
        const billingBefore = await db
          .select()
          .from(organizationBilling)
          .where(eq(organizationBilling.organizationId, child.organizationId));
        let persisted = false;
        const probe = spyOn(
          persistence,
          "persistVerifiedMutation",
        ).mockImplementation(async (...args) => {
          // Run actual persistence in the actual request transaction. Reaching
          // this call proves the earlier admission guard allowed the mutation.
          const result = await persist(...args);
          const head = await readHead(args[0].executor, child.containerId);
          expect(head[0]?.manifestHash).toBe(request.expectedManifestHash);
          persisted = true;
          setSystemTime(boundary.now);
          return result;
        });
        restore = () => probe.mockRestore();
        const response = await postMutation({
          path: `/containers/${child.containerId}/rekey`,
          request,
          token: owner.token,
        });
        expect(persisted).toBe(true);
        expect(response.status, await response.clone().text()).toBe(
          boundary.responseStatus,
        );
        const after = await readHead(db, child.containerId);
        if (boundary.responseStatus === 402) {
          expect(await response.json()).toMatchObject({
            reason: "billing_inactive",
          });
          expect(after).toEqual(before);
          expect(
            await db
              .select()
              .from(accessManifests)
              .where(
                eq(accessManifests.manifestHash, request.expectedManifestHash),
              ),
          ).toEqual([]);
        } else {
          expect(after[0]?.manifestHash).toBe(request.expectedManifestHash);
        }
        // The expiry decision changed solely because time changed, not rows.
        expect(
          await db
            .select()
            .from(organizationBilling)
            .where(
              eq(organizationBilling.organizationId, child.organizationId),
            ),
        ).toEqual(billingBefore);
      } finally {
        restore();
        setSystemTime();
      }
    });
  }
}

test("the public mutation boundary rereads a seat released in the transaction", async () => {
  const persist = persistence.persistVerifiedMutation;
  let restore = () => {};
  try {
    const { owner, child, request } = await scenario("active");
    const before = await readHead(db, child.containerId);
    const seatScope = and(
      eq(
        organizationBillingSeatAssignments.organizationId,
        child.organizationId,
      ),
      eq(organizationBillingSeatAssignments.userId, owner.userId),
      isNull(organizationBillingSeatAssignments.releasedAt),
    );
    const seatsBefore = await db
      .select()
      .from(organizationBillingSeatAssignments)
      .where(seatScope);
    expect(seatsBefore).toHaveLength(1);
    let persisted = false;
    const probe = spyOn(
      persistence,
      "persistVerifiedMutation",
    ).mockImplementation(async (...args) => {
      const result = await persist(...args);
      expect(
        (await readHead(args[0].executor, child.containerId))[0]?.manifestHash,
      ).toBe(request.expectedManifestHash);
      persisted = true;
      // Same-transaction visibility, NOT a claim that another connection can
      // bypass organization/billing writer locks. Concurrency needs Postgres.
      await args[0].executor
        .update(organizationBillingSeatAssignments)
        .set({ releasedAt: ADMITTED_AT })
        .where(seatScope);
      return result;
    });
    restore = () => probe.mockRestore();
    const response = await postMutation({
      path: `/containers/${child.containerId}/rekey`,
      request,
      token: owner.token,
    });
    expect(persisted).toBe(true);
    expect(response.status, await response.clone().text()).toBe(402);
    expect(await response.json()).toMatchObject({
      reason: "sync_seat_unassigned",
    });
    expect(await readHead(db, child.containerId)).toEqual(before);
    expect(
      await db
        .select()
        .from(organizationBillingSeatAssignments)
        .where(seatScope),
    ).toEqual(seatsBefore);
  } finally {
    restore();
    setSystemTime();
  }
});
