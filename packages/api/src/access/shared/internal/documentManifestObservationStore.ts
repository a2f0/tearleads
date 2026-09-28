import type {
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import { documentManifestObservations } from "@tearleads/api-shared/schema";
import { and, eq, type SQL } from "drizzle-orm";

export async function recordDocumentManifestObservationInTransaction(
  executor: DatabaseTransaction,
  input: {
    readonly documentId: string;
    readonly manifestHash: string;
    readonly userId: string;
  },
): Promise<void> {
  await executor
    .insert(documentManifestObservations)
    .values(input)
    .onConflictDoNothing();
}

interface DocumentObservationScope {
  readonly documentId: string;
  readonly userId: string;
}

async function hasObservation(
  executor: DatabaseSession,
  input: DocumentObservationScope,
  manifestCondition?: SQL,
): Promise<boolean> {
  const [observation] = await executor
    .select({ id: documentManifestObservations.id })
    .from(documentManifestObservations)
    .where(
      and(
        eq(documentManifestObservations.documentId, input.documentId),
        eq(documentManifestObservations.userId, input.userId),
        manifestCondition,
      ),
    )
    .limit(1);
  return observation !== undefined;
}

export function hasDocumentManifestObservation(
  executor: DatabaseSession,
  input: DocumentObservationScope & { readonly manifestHash: string },
): Promise<boolean> {
  return hasObservation(
    executor,
    input,
    eq(documentManifestObservations.manifestHash, input.manifestHash),
  );
}

export function hasAnyDocumentManifestObservation(
  executor: DatabaseSession,
  input: DocumentObservationScope,
): Promise<boolean> {
  return hasObservation(executor, input);
}
