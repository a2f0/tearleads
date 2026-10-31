import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizations,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { registerOrganization } from "../../../test/helpers/organizationPurge";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { lockPrincipalMutationInTransaction } from "../principals/principalMutationLock";
import { purgeClaimedOrganizationRemoteData } from "./organizationPurge";
import { claimOrganizationForPurge } from "./organizationPurgeCandidates";

async function claimedOrganization() {
  const organizationId = await registerOrganization();
  const now = new Date("2099-08-30T12:00:00.000Z");
  await db
    .update(organizationBilling)
    .set({ purgeAfter: new Date(now.getTime() - 1), status: "disabled" })
    .where(eq(organizationBilling.organizationId, organizationId));
  const claim = await claimOrganizationForPurge(db, organizationId, now);
  invariant(claim, "expected purge claim");
  const [organization] = await db
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  invariant(organization, "expected organization");
  return { claim, memberGroupId: organization.memberGroupId, now };
}

// A policy transaction keeps the current state it read under a principal's
// lock for the rest of the transaction, so organization purge must not
// delete principal states while any such transaction is in flight: it takes
// the organization's lock and each of its groups' locks first.
test
  .skipIf(getDefaultApiDatabaseKind() !== "postgres")
  .each([["organization"], ["group"]] as const)(
  "organization purge waits for a transaction holding a %s principal lock",
  async (principalType) => {
    const fixture = await claimedOrganization();
    const principalId =
      principalType === "organization"
        ? fixture.claim.organizationId
        : fixture.memberGroupId;
    const heldStates: (string | undefined)[] = [];
    const holder = await holdPostgresLock(async (tx) => {
      await lockPrincipalMutationInTransaction(tx, principalType, principalId);
      heldStates.push(
        (await getCurrentPrincipalState(principalType, principalId, tx))
          ?.stateHash,
      );
    });

    const purge = purgeClaimedOrganizationRemoteData({
      claim: fixture.claim,
      db,
      now: fixture.now,
    });
    let stateWhileHeld: unknown;
    try {
      await waitForPostgresLockWait({
        blockerPid: holder.backendPid,
        queryFragment: "pg_advisory_xact_lock",
      });
      stateWhileHeld = await getCurrentPrincipalState(
        principalType,
        principalId,
        db,
      );
    } finally {
      await holder.release();
    }

    expect(await purge).toBeDefined();
    expect(heldStates[0]).toBeString();
    expect(stateWhileHeld).toMatchObject({ stateHash: heldStates[0] });
    expect(
      await getCurrentPrincipalState(principalType, principalId, db),
    ).toBeNull();
  },
  30_000,
);
