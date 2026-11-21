import {
  type HeldDirectoryCitation,
  isPrincipalStatePayloadResponse,
  isPrincipalStateResponse,
} from "@tearleads/validators/response";
import { KNOWN_DIRECTORY_HINT_LIMIT } from "@tearleads/validators/util";
import { and, asc, desc, eq } from "drizzle-orm";
import { principalPolicyBundles } from "../../sqlite/schema/principalPolicySchema";
import {
  type ClientSQLiteDatabase,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";

function parsed(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * The organization directory payloads this device holds in its verified
 * policy bundles, its current state first, at most
 * `KNOWN_DIRECTORY_HINT_LIMIT`. Each travels with its signed state: the
 * request cites a payload only when its bytes hash to that state's
 * `payloadCiphertextHash`, so a refill is exactly the bytes the server would
 * send.
 */
export async function heldDirectoryCitations(
  execSql: ExecSql,
  organizationId: string,
): Promise<HeldDirectoryCitation[]> {
  // Citing only saves bytes: a device that has stored no policy bundle yet
  // (so no table) or cannot read them cites no directory.
  const rows = await heldDirectoryRows(
    getClientSQLitePersistenceRuntime(execSql).db,
    organizationId,
  ).catch(() => []);
  const citations: HeldDirectoryCitation[] = [];
  for (const row of rows) {
    const directoryState = parsed(row.stateJson);
    const directoryPayload = parsed(row.payloadJson);
    // A row must name its own state of this organization, so a request
    // never cites another organization's state hash.
    if (
      isPrincipalStateResponse(directoryState) &&
      isPrincipalStatePayloadResponse(directoryPayload) &&
      directoryState.stateHash === row.stateHash &&
      directoryState.principalType === "organization" &&
      directoryState.principalId === organizationId
    )
      // Only the ciphertext travels on: a payload cached before #2903 P23
      // also carries fields that no reader uses.
      citations.push({
        directoryState,
        directoryPayload: { ciphertext: directoryPayload.ciphertext },
      });
  }
  return citations;
}

function heldDirectoryRows(db: ClientSQLiteDatabase, organizationId: string) {
  return db
    .select({
      stateHash: principalPolicyBundles.stateHash,
      stateJson: principalPolicyBundles.currentStateJson,
      payloadJson: principalPolicyBundles.currentPayloadJson,
    })
    .from(principalPolicyBundles)
    .where(
      and(
        eq(principalPolicyBundles.principalType, "organization"),
        eq(principalPolicyBundles.principalId, organizationId),
      ),
    )
    .orderBy(
      desc(principalPolicyBundles.isCurrent),
      desc(principalPolicyBundles.updatedAt),
      asc(principalPolicyBundles.stateHash),
    )
    .limit(KNOWN_DIRECTORY_HINT_LIMIT);
}
