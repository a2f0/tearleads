import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  documentContentWriteHeaders,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { eq, inArray } from "drizzle-orm";

/** Only call after selecting the prefix bounded by response byte floors. */
export async function loadDocumentUpdatePageRows(
  executor: DatabaseSession,
  ids: readonly string[],
) {
  if (ids.length === 0) return [];
  return executor
    .select({
      update: documentUpdates,
      writeHeader: {
        authorizationTargets: documentContentWriteHeaders.authorizationTargets,
        header: documentContentWriteHeaders.header,
        headerHash: documentContentWriteHeaders.headerHash,
      },
    })
    .from(documentUpdates)
    .leftJoin(
      documentContentWriteHeaders,
      eq(documentContentWriteHeaders.updateId, documentUpdates.id),
    )
    .where(inArray(documentUpdates.id, [...ids]));
}

export type DocumentUpdatePageWriteHeader = NonNullable<
  Awaited<ReturnType<typeof loadDocumentUpdatePageRows>>[number]["writeHeader"]
>;
