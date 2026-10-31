import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  documentContentWriteHeaders,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { eq, inArray, sql } from "drizzle-orm";
import {
  jsonByteFloorExpression as jsonBytes,
  textByteLengthExpression as textBytes,
} from "../utils/sqlDialect";

function readByteCount(value: unknown): number {
  const count = typeof value === "string" ? Number(value) : value;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("Unexpected document update byte floor");
  }
  return count;
}

/**
 * The fewest bytes each update can add to a sync response, from the stored
 * lengths of every variable-size part of its response entry: the ciphertext
 * (`byte_length`), author fingerprint, version vectors, plaintext hash, a
 * checkpoint's source version vector, and the compact JSON of its write
 * header and authorization targets. JSON never encodes a value in fewer
 * bytes, so a page prefix whose floors overflow the byte ceiling cannot fit,
 * and nothing past it has to be loaded to find the page. What the floors
 * leave out is fixed-size: keys, ids, epochs, and timestamps.
 */
export async function listDocumentUpdateResponseByteFloors(
  executor: DatabaseSession,
  updateIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (updateIds.length === 0) return new Map();
  const rows = await executor
    .select({
      ciphertextBytes: documentUpdates.byteLength,
      id: documentUpdates.id,
      textBytes: sql<unknown>`${textBytes(documentUpdates.authorFingerprint)}
        + ${textBytes(documentUpdates.partialStartVersionVector)}
        + ${textBytes(documentUpdates.partialEndVersionVector)}
        + ${textBytes(documentUpdates.plaintextHash)}
        + coalesce(${textBytes(documentUpdates.baselineSourceVersionVector)}, 0)
        + coalesce(${jsonBytes(documentContentWriteHeaders.header)}, 0)
        + coalesce(${jsonBytes(documentContentWriteHeaders.authorizationTargets)}, 0)`,
    })
    .from(documentUpdates)
    // A missing header is the response's own integrity failure to report.
    .leftJoin(
      documentContentWriteHeaders,
      eq(documentContentWriteHeaders.updateId, documentUpdates.id),
    )
    .where(inArray(documentUpdates.id, [...updateIds]));
  return new Map(
    rows.map((row) => [
      row.id,
      readByteCount(row.ciphertextBytes) + readByteCount(row.textBytes),
    ]),
  );
}

/**
 * The longest prefix of `candidates` whose floors fit `maxSerializedBytes`,
 * counting the JSON array's brackets and commas. It always keeps the first
 * candidate, so an update too large for any page still reaches the exact
 * ceiling check. Returns `undefined` when a candidate has no floor, meaning
 * its row changed after the candidates were listed.
 */
export function prefixWithinResponseByteFloors<
  Candidate extends { readonly id: string },
>(
  candidates: readonly Candidate[],
  floors: ReadonlyMap<string, number>,
  maxSerializedBytes: number,
): Candidate[] | undefined {
  const prefix: Candidate[] = [];
  let bytes = 2; // JSON array brackets.
  for (const candidate of candidates) {
    const floor = floors.get(candidate.id);
    if (floor === undefined) return undefined;
    const addedBytes = floor + (prefix.length === 0 ? 0 : 1);
    if (prefix.length > 0 && bytes + addedBytes > maxSerializedBytes) break;
    prefix.push(candidate);
    bytes += addedBytes;
  }
  return prefix;
}
