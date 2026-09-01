import type {
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import { documentManifestObservations } from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";

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

export async function hasDocumentManifestObservation(
  executor: DatabaseSession,
  input: {
    readonly documentId: string;
    readonly manifestHash: string;
    readonly userId: string;
  },
): Promise<boolean> {
  const [observation] = await executor
    .select({ id: documentManifestObservations.id })
    .from(documentManifestObservations)
    .where(
      and(
        eq(documentManifestObservations.documentId, input.documentId),
        eq(documentManifestObservations.manifestHash, input.manifestHash),
        eq(documentManifestObservations.userId, input.userId),
      ),
    )
    .limit(1);
  return observation !== undefined;
}
