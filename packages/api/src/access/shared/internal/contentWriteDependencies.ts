import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  attachmentBindings,
  blobContentWriteHeaders,
  documentContentWriteHeaders,
} from "@tearleads/api-shared/schema";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { isSqliteApiDatabase, uuidValue } from "../../../utils/sqlDialect";

function dependencyValues(header: SQL): SQL {
  return isSqliteApiDatabase()
    ? sql`json_each(${header}, '$.dependencyManifestHashes') as dependency`
    : sql`jsonb_array_elements_text(${header}->'dependencyManifestHashes') as dependency(value)`;
}

const dependencyHashRowSchema = z.object({ hash: z.string() });

/** Transfer unique signed path hashes, not every retained ciphertext header. */
export async function listDocumentContentWriteDependencyHashes(
  documentId: string,
  executor: DatabaseSession,
): Promise<string[]> {
  const result = await executor.execute(sql`
    select dependency.value as hash
    from ${documentContentWriteHeaders}
    cross join ${dependencyValues(sql`${documentContentWriteHeaders.header}`)}
    where ${documentContentWriteHeaders.documentId} = ${uuidValue(documentId)}
    union
    select dependency.value as hash
    from ${blobContentWriteHeaders}
    inner join ${attachmentBindings}
      on ${attachmentBindings.blobId} = ${blobContentWriteHeaders.blobId}
    cross join ${dependencyValues(sql`${blobContentWriteHeaders.header}`)}
    where ${attachmentBindings.documentId} = ${uuidValue(documentId)}
  `);
  return result.rows
    .map((row) => {
      const parsed = dependencyHashRowSchema.safeParse(row);
      if (!parsed.success)
        throw new Error("Invalid stored write dependency hash");
      return parsed.data.hash;
    })
    .sort();
}
