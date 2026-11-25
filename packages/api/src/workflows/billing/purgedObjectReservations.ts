import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  type PurgedObjectKind,
  purgedObjectReservations,
  users,
} from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import { organizationPurgeBatches } from "./organizationPurgeBatches";

/** The refusal a create of a document id reserved for another user gets. */
export const PURGED_DOCUMENT_ID_RESERVED =
  "Document ID is reserved for its purged organization's recovery";
/** The refusal a create of a container id reserved for another user gets. */
export const PURGED_CONTAINER_ID_RESERVED =
  "Container ID is reserved for its purged organization's recovery";

/**
 * Reserves every container and document id a billing purge frees for the user
 * who alone may recover the organization: the one whose default (personal)
 * organization it is, as `assertReplacementReady` requires. It runs in the
 * transaction that deletes their rows, so a create sees either the rows or the
 * reservation. A shared organization has no such user and cannot be recovered,
 * so its purge reserves nothing.
 */
export async function reservePurgedOrganizationObjects(input: {
  readonly containerIds: readonly string[];
  readonly documentIds: readonly string[];
  readonly executor: DatabaseTransaction;
  readonly organizationId: string;
}): Promise<void> {
  const owners = await input.executor
    .select({ id: users.id })
    .from(users)
    .where(eq(users.defaultOrganizationId, input.organizationId))
    .limit(2);
  if (owners.length > 1) {
    throw new Error("Personal organization has more than one owner");
  }
  const owner = owners[0];
  if (!owner) return;
  const objects: { objectId: string; objectKind: PurgedObjectKind }[] = [
    ...input.containerIds.map((objectId) => ({
      objectId,
      objectKind: "container" as const,
    })),
    ...input.documentIds.map((objectId) => ({
      objectId,
      objectKind: "document" as const,
    })),
  ];
  for (const batch of organizationPurgeBatches(objects)) {
    await input.executor
      .insert(purgedObjectReservations)
      .values(
        batch.map((object) => ({
          ...object,
          ownerUserId: owner.id,
          purgedOrganizationId: input.organizationId,
        })),
      )
      .onConflictDoNothing();
  }
}

/**
 * Lets `userId` create an object whose id may be reserved: true when the id is
 * unreserved or reserved for that user, whose create then consumes the
 * reservation in its own transaction; false when another user holds it, and
 * the caller refuses the create. A caller that does not otherwise read the
 * id's head runs this after inserting the object's row: that insert waits out
 * a purge deleting the same row, so this read then sees its reservation.
 */
export async function claimPurgedObjectReservation(
  executor: DatabaseTransaction,
  input: {
    readonly objectId: string;
    readonly objectKind: PurgedObjectKind;
    readonly userId: string;
  },
): Promise<boolean> {
  const object = and(
    eq(purgedObjectReservations.objectKind, input.objectKind),
    eq(purgedObjectReservations.objectId, input.objectId),
  );
  const [reservation] = await executor
    .select({ ownerUserId: purgedObjectReservations.ownerUserId })
    .from(purgedObjectReservations)
    .where(object)
    .limit(1);
  if (!reservation) return true;
  if (reservation.ownerUserId !== input.userId) return false;
  await releasePurgedObjectReservation(executor, input);
  return true;
}

/** Consumes a reservation the creating owner already read. */
export async function releasePurgedObjectReservation(
  executor: DatabaseTransaction,
  input: {
    readonly objectId: string;
    readonly objectKind: PurgedObjectKind;
    readonly userId: string;
  },
): Promise<void> {
  await executor
    .delete(purgedObjectReservations)
    .where(
      and(
        eq(purgedObjectReservations.objectKind, input.objectKind),
        eq(purgedObjectReservations.objectId, input.objectId),
        eq(purgedObjectReservations.ownerUserId, input.userId),
      ),
    );
}
