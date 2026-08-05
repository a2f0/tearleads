import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingSeatAssignments,
  organizations,
  principalMembershipProjection,
  principalStates,
} from "@tearleads/api-shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { reconcileOrganizationBillingSeats } from "./organizationSeats";

const NOW = new Date("2026-07-15T00:00:00.000Z");
const PERIOD_END = new Date("2026-08-01T00:00:00.000Z");

async function insertGroupState(input: {
  readonly groupId: string;
  readonly signerUserId: string;
  readonly stateHash: string;
  readonly userIds: readonly string[];
}): Promise<void> {
  await db.insert(principalStates).values({
    principalType: "group",
    principalId: input.groupId,
    version: 1,
    keyEpoch: 1,
    encapsulationPublicKey: "encapsulation-public-key",
    keyFingerprint: "key-fingerprint",
    membershipMode: "projection",
    membershipRoot: `membership-root-${input.stateHash}`,
    memberEnvelopesRoot: `member-envelopes-root-${input.stateHash}`,
    projectionRoot: `projection-root-${input.stateHash}`,
    payloadCiphertextHash: `payload-ciphertext-${input.stateHash}`,
    memberCount: input.userIds.length,
    stateHash: input.stateHash,
    signedAt: NOW,
    signerUserId: input.signerUserId,
    signerUserKeyFingerprint: "signer-key-fingerprint",
    signature: `signature-${input.stateHash}`,
  });
  await db.insert(principalMembershipProjection).values(
    input.userIds.map((userId) => ({
      principalType: "group" as const,
      principalId: input.groupId,
      stateHash: input.stateHash,
      userId,
      role: "member" as const,
    })),
  );
}

test("fresh seat capacity assigns an active administrator before other members", async () => {
  const organizationId = crypto.randomUUID();
  const adminGroupId = crypto.randomUUID();
  const memberGroupId = crypto.randomUUID();
  const adminUserId = crypto.randomUUID();
  const otherUserIds = Array.from({ length: 10 }, () => crypto.randomUUID());
  await db.insert(organizations).values({
    id: organizationId,
    adminGroupId,
    memberGroupId,
    name: "Admin priority organization",
  });
  await db.insert(organizationBilling).values({
    organizationId,
    status: "trialing",
    trialEndsAt: PERIOD_END,
    seatCount: 0,
  });
  await insertGroupState({
    groupId: memberGroupId,
    signerUserId: adminUserId,
    stateHash: "admin-priority-members",
    userIds: [adminUserId, ...otherUserIds],
  });
  await insertGroupState({
    groupId: adminGroupId,
    signerUserId: adminUserId,
    stateHash: "admin-priority-admins",
    userIds: [adminUserId],
  });

  await reconcileOrganizationBillingSeats({
    executor: db,
    now: NOW,
    organizationId,
    source: { sourceId: "trial-start", sourceType: "billing_transition" },
  });

  const assignments = await db
    .select({ userId: organizationBillingSeatAssignments.userId })
    .from(organizationBillingSeatAssignments)
    .where(
      and(
        eq(organizationBillingSeatAssignments.organizationId, organizationId),
        isNull(organizationBillingSeatAssignments.releasedAt),
      ),
    );
  expect(assignments).toHaveLength(10);
  expect(assignments.map(({ userId }) => userId)).toContain(adminUserId);
});
