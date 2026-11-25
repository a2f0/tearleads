import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestHeads,
  containerMetadataDocuments,
  documents,
  purgedObjectReservations,
} from "@tearleads/api-shared/schema";
import { and, eq, or, sql } from "drizzle-orm";
import {
  PURGED_CONTAINER_ID_RESERVED,
  PURGED_DOCUMENT_ID_RESERVED,
  releasePurgedObjectReservation,
} from "../../../billing/purgedObjectReservations";
import { lockDocumentLifecycleInTransaction } from "../../../documents/mutations/documentLifecycleLock";
import { ContainerMutationError } from "../errors";
import type { VerifiedContainerAccessState } from "../types";

type ReservationEvidence =
  | "containerForOther"
  | "containerForRequester"
  | "document"
  | "documentForOther"
  | "documentForRequester"
  | "head"
  | "purge"
  | "reservation";

interface ContainerCreateIds {
  readonly containerId: string;
  readonly metadataDocumentId: string;
  readonly requesterUserId: string;
}

async function readCreateIdEvidence(
  executor: DatabaseTransaction,
  input: ContainerCreateIds,
): Promise<ReservationEvidence[]> {
  const { metadataDocumentId } = input;
  const reservation = purgedObjectReservations;
  const rows = await executor
    .select({ kind: sql<ReservationEvidence>`'purge'` })
    .from(accessEvents)
    .where(
      and(
        eq(accessEvents.eventType, "document.purge"),
        eq(accessEvents.objectKind, "document"),
        eq(accessEvents.objectId, metadataDocumentId),
      ),
    )
    .unionAll(
      executor
        .select({ kind: sql<ReservationEvidence>`'head'` })
        .from(accessManifestHeads)
        .where(
          and(
            eq(accessManifestHeads.objectKind, "document"),
            eq(accessManifestHeads.objectId, metadataDocumentId),
          ),
        ),
    )
    .unionAll(
      executor
        .select({ kind: sql<ReservationEvidence>`'document'` })
        .from(documents)
        .where(eq(documents.id, metadataDocumentId)),
    )
    .unionAll(
      executor
        .select({ kind: sql<ReservationEvidence>`'reservation'` })
        .from(containerMetadataDocuments)
        .where(eq(containerMetadataDocuments.documentId, metadataDocumentId)),
    )
    .unionAll(
      executor
        .select({
          kind: sql<ReservationEvidence>`${reservation.objectKind} || case when ${reservation.ownerUserId} = ${input.requesterUserId} then 'ForRequester' else 'ForOther' end`,
        })
        .from(reservation)
        .where(
          or(
            and(
              eq(reservation.objectKind, "container"),
              eq(reservation.objectId, input.containerId),
            ),
            and(
              eq(reservation.objectKind, "document"),
              eq(reservation.objectId, metadataDocumentId),
            ),
          ),
        ),
    );
  return rows.map((row) => row.kind);
}

/**
 * A container create's ids must be free. Its metadata document id must be
 * unused by every document lifecycle stage: purge deletes the document row but
 * keeps its terminal event, so the row check alone would let a container claim
 * a purged id whose document can never be created again. The document
 * lifecycle lock orders this check against a concurrent create of the same
 * id. One statement reads every kind of evidence; a purge event still refuses
 * first, and more than one is corruption.
 *
 * An id an organization purge freed is held for that organization's owner,
 * so only `requesterUserId` as that owner may create the container or bind the
 * metadata id, and doing so consumes the reservation: from then on the
 * container's head or the binding guards the id. The mutation read the
 * container's head as absent in an earlier statement, after any purge of it
 * committed, so this later statement sees that purge's reservation.
 */
export async function assertContainerCreateIdsAvailable(
  executor: DatabaseTransaction,
  input: ContainerCreateIds,
): Promise<void> {
  await lockDocumentLifecycleInTransaction(executor, input.metadataDocumentId);
  const kinds = await readCreateIdEvidence(executor, input);
  const purgeEvents = kinds.filter((kind) => kind === "purge").length;
  if (purgeEvents > 1) {
    throw new Error("Stored access event type is not unique for its object");
  }
  if (purgeEvents === 1) {
    throw new ContainerMutationError(
      "Container metadata document was permanently purged",
      409,
    );
  }
  if (kinds.includes("containerForOther")) {
    throw new ContainerMutationError(PURGED_CONTAINER_ID_RESERVED, 409);
  }
  if (kinds.includes("documentForOther")) {
    throw new ContainerMutationError(PURGED_DOCUMENT_ID_RESERVED, 409);
  }
  const consumed = kinds.filter(
    (kind) =>
      kind === "containerForRequester" || kind === "documentForRequester",
  );
  if (consumed.length < kinds.length) {
    throw new ContainerMutationError(
      "Container metadata document already exists",
      409,
    );
  }
  for (const kind of consumed) {
    await releasePurgedObjectReservation(executor, {
      objectId:
        kind === "containerForRequester"
          ? input.containerId
          : input.metadataDocumentId,
      objectKind: kind === "containerForRequester" ? "container" : "document",
      userId: input.requesterUserId,
    });
  }
}

export async function insertContainerMetadataBinding(
  executor: DatabaseTransaction,
  state: VerifiedContainerAccessState,
): Promise<void> {
  const [metadataBinding] = await executor
    .insert(containerMetadataDocuments)
    .values({
      containerId: state.containerId,
      documentId: state.metadataDocumentId,
    })
    .onConflictDoNothing()
    .returning({ containerId: containerMetadataDocuments.containerId });
  if (!metadataBinding) {
    throw new ContainerMutationError(
      "Container metadata binding already exists",
      409,
    );
  }
}
