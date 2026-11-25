import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  containers,
  organizationBilling,
  organizationReadModelHeads,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { and, eq, isNull } from "drizzle-orm";
import invariant from "invariant";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import { registerOrganization } from "../../../test/helpers/organizationPurge";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerAndAuthenticateUsers } from "../../../test/helpers/principalPolicyReadFixtures";
import { purgeClaimedOrganizationRemoteData } from "./organizationPurge";
import { claimOrganizationForPurge } from "./organizationPurgeCandidates";

// Provisioning inserts its root with no earlier read of that id. The insert
// waits out a purge deleting the same row, then succeeds once the purge
// commits; only a read after it sees the reservation that purge committed. A
// reservation check before the insert reads the pre-purge snapshot, finds
// nothing, and lets another user take the owner's old root id.
test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a root provisioned while a purge frees that id sees the purge's reservation",
  async () => {
    const organizationId = await registerOrganization();
    const [root] = await db
      .select({ id: containers.id })
      .from(containers)
      .where(
        and(
          eq(containers.organizationId, organizationId),
          isNull(containers.parentId),
        ),
      );
    invariant(root, "expected the personal organization's root");
    const now = new Date("2099-08-30T12:00:00.000Z");
    await db
      .update(organizationBilling)
      .set({ purgeAfter: new Date(now.getTime() - 1), status: "disabled" })
      .where(eq(organizationBilling.organizationId, organizationId));
    const claim = await claimOrganizationForPurge(db, organizationId, now);
    invariant(claim, "expected purge claim");
    const mallory = createTestUser();
    await registerAndAuthenticateUsers(mallory);
    const request = await createOrganizationRequestBody(mallory, {
      rootContainerId: root.id,
    });

    // The purge's last statement deletes this row, after its container rows.
    const holder = await holdPostgresLock(async (tx) => {
      await tx
        .select({ organizationId: organizationReadModelHeads.organizationId })
        .from(organizationReadModelHeads)
        .where(eq(organizationReadModelHeads.organizationId, organizationId))
        .for("update");
    });
    const purge = purgeClaimedOrganizationRemoteData({ claim, db, now });
    let provisioning: Promise<Response> | undefined;
    let synchronizationError: unknown;
    try {
      await waitForPostgresLockWait({
        blockerPid: holder.backendPid,
        queryFragment: "organization_read_model_heads",
      });
      provisioning = Promise.resolve(
        submitCreateOrganization(mallory, request),
      );
      await waitForPostgresLockWait({
        blockerPid: holder.backendPid,
        queryFragment: 'insert into "containers"',
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await holder.release();
    }
    expect(await purge).toBeDefined();
    const response = await provisioning;
    if (synchronizationError) throw synchronizationError;

    expect(response?.status).toBe(409);
    expect(await response?.json()).toEqual({
      error: "Root container ID is unavailable",
    });
    expect(
      await db
        .select({ id: containers.id })
        .from(containers)
        .where(eq(containers.id, root.id)),
    ).toEqual([]);
  },
  30_000,
);
