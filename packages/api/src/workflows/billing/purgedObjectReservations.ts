import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  documentPeerOwners,
  documentUpdateSpans,
  type PurgedObjectKind,
  purgedDocumentPeerOwners,
  purgedObjectReservations,
  users,
} from "@tearleads/api-shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { uuidValue } from "../../utils/postgresSql";
import { organizationPurgeBatches } from "./organizationPurgeBatches";

/** The refusal a create of a document id reserved for another user gets. */
export const PURGED_DOCUMENT_ID_RESERVED =
  "Document ID is reserved for its purged organization's recovery";
/** The refusal a create of a container id reserved for another user gets. */
export const PURGED_CONTAINER_ID_RESERVED =
  "Container ID is reserved for its purged organization's recovery";

/**
 * The user whose personal (default) organization is `organizationId`, or null
 * for a shared organization. Throws if invariants are violated.
 */
export async function findPersonalOrganizationOwnerId(
  executor: DatabaseTransaction,
  organizationId: string,
): Promise<string | null> {
  const owners = await executor
    .select({ id: users.id })
    .from(users)
    .where(eq(users.defaultOrganizationId, organizationId))
    .limit(2);
  if (owners.length > 1) {
    throw new Error("Personal organization has more than one owner");
  }
  return owners[0]?.id ?? null;
}

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
}): Promise<string | null> {
  const ownerId = await findPersonalOrganizationOwnerId(
    input.executor,
    input.organizationId,
  );
  if (!ownerId) return null;
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
          ownerUserId: ownerId,
          purgedOrganizationId: input.organizationId,
        })),
      )
      .onConflictDoNothing();
  }
  return ownerId;
}

/**
 * Snapshots every committed peer owner and its highest pre-purge frontier for
 * documents being deleted in a personal-organization billing purge. Runs in
 * the same transaction BEFORE `deleteDocumentRows` removes `document_peer_owners`
 * and `document_update_spans`. Taking `GREATEST` preserves the full pre-purge
 * frontier across repeated purge/stale-recreation cycles (#3263).
 */
export async function snapshotPurgedDocumentPeerOwners(input: {
  readonly documentIds: readonly string[];
  readonly executor: DatabaseTransaction;
  readonly organizationId: string;
  readonly recoveryOwnerUserId?: string | null | undefined;
}): Promise<void> {
  if (input.documentIds.length === 0) return;
  const ownerId =
    input.recoveryOwnerUserId === undefined
      ? await findPersonalOrganizationOwnerId(
          input.executor,
          input.organizationId,
        )
      : input.recoveryOwnerUserId;
  if (!ownerId) return;
  const recoveryOwner = uuidValue(ownerId);
  for (const batch of organizationPurgeBatches(input.documentIds)) {
    const idList = sql.join(
      batch.map((documentId) => uuidValue(documentId)),
      sql`, `,
    );
    await input.executor.execute(sql`
      insert into ${purgedDocumentPeerOwners} (
        document_id, peer_id, owner_user_id, purged_end_counter,
        recovery_owner_user_id
      )
      select
        dpo.document_id,
        dpo.peer_id,
        dpo.owner_user_id,
        greatest(coalesce(spans.max_end_counter, 0), dpo.restorable_end_counter),
        ${recoveryOwner}
      from ${documentPeerOwners} dpo
      left join (
        select document_id, peer_id, max(end_counter) as max_end_counter
        from ${documentUpdateSpans}
        where document_id in (${idList})
        group by document_id, peer_id
      ) spans
        on spans.document_id = dpo.document_id
        and spans.peer_id = dpo.peer_id
      where dpo.document_id in (${idList})
      on conflict (document_id, peer_id) do update set
        owner_user_id = excluded.owner_user_id,
        purged_end_counter = greatest(
          ${purgedDocumentPeerOwners.purgedEndCounter},
          excluded.purged_end_counter
        ),
        recovery_owner_user_id = excluded.recovery_owner_user_id
    `);
  }
}

/**
 * Atomically moves snapshotted pre-purge peer owners back into
 * `document_peer_owners` when the personal organization's owner recreates a
 * reserved document. Returns true when at least one peer owner was restored.
 */
export async function restorePurgedDocumentPeerOwners(
  executor: DatabaseTransaction,
  input: {
    readonly documentId: string;
    readonly recoveryOwnerUserId: string;
  },
): Promise<boolean> {
  const result = await executor.execute(sql`
    with consumed as (
      delete from ${purgedDocumentPeerOwners}
      where document_id = ${uuidValue(input.documentId)}
        and recovery_owner_user_id = ${uuidValue(input.recoveryOwnerUserId)}
      returning document_id, peer_id, owner_user_id, purged_end_counter,
        recovery_owner_user_id
    )
    insert into ${documentPeerOwners} (
      document_id, peer_id, owner_user_id, restorable_end_counter,
      recovery_owner_user_id, allow_member_restore
    )
    select
      document_id, peer_id, owner_user_id, purged_end_counter,
      recovery_owner_user_id, false
    from consumed
    returning peer_id
  `);
  return result.rows.length > 0;
}

/**
 * Lets `userId` create an object whose id may be reserved: true when the id is
 * unreserved or reserved for that user, whose create then consumes the
 * reservation in its own transaction; false when another user holds it, and
 * the caller refuses the create. A caller that reads no head for the id first
 * runs this after inserting the object's row: that insert waits out a purge
 * deleting the same row, so this later read sees the purge's reservation,
 * where a read before the insert would see the pre-purge snapshot.
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
