import {
  type CurrentPrincipalMemberEnvelopesResponse,
  isCurrentPrincipalMemberEnvelopesResponse,
} from "@tearleads/validators/response";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  principalHistoryEvidenceTables,
  principalHistoryPrefixes,
} from "../sqlite/principalHistoryEvidenceSchema";
import { principalHistoryStages } from "../sqlite/principalHistoryStageSchema";
import {
  principalCurrentFingerprintJson,
  principalStateFingerprintJson,
} from "../sqlite/principalKeyFingerprintJson";
import {
  principalPolicies,
  principalPolicyBundleHistory,
} from "../sqlite/principalPolicySchema";
import { principalPolicyTables } from "../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";

export interface PrincipalKeyEnvelopeCandidate {
  readonly currentState: {
    readonly principalType: "group" | "organization";
    readonly principalId: string;
    readonly stateHash: string;
    readonly keyFingerprint: string;
  };
  readonly currentMemberEnvelopes: CurrentPrincipalMemberEnvelopesResponse;
}

/**
 * Untrusted encrypted key candidates, never authorization evidence. The actual
 * private key must open the requested recipient wrap; the projection verifier
 * separately checks the signed KEK material identity and all policy authority.
 * Read only envelopes for the requested fingerprints, never signed histories.
 */
export async function loadPrincipalKeyEnvelopeCandidates(
  execSql: ExecSql,
  fingerprints: readonly string[],
): Promise<PrincipalKeyEnvelopeCandidate[]> {
  await ensureSqlTables(execSql, [
    ...principalPolicyTables,
    ...principalHistoryEvidenceTables,
  ]);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const candidates: PrincipalKeyEnvelopeCandidate[] = [];
  for (const fingerprint of new Set(fingerprints)) {
    const encoded: string[] = [];
    for (const table of [principalPolicies, principalPolicyBundleHistory]) {
      const [row] = await db
        .select({ envelopes: table.currentMemberEnvelopesJson })
        .from(table)
        .where(
          eq(
            principalStateFingerprintJson(table.currentStateJson),
            fingerprint,
          ),
        )
        .orderBy(desc(table.updatedAt))
        .limit(1);
      if (row) encoded.push(row.envelopes);
    }
    const [prefix] = await db
      .select({
        envelopes: sql<string>`json_extract(${principalHistoryPrefixes.currentJson}, '$.currentMemberEnvelopes')`,
      })
      .from(principalHistoryPrefixes)
      .where(
        eq(
          principalCurrentFingerprintJson(principalHistoryPrefixes.currentJson),
          fingerprint,
        ),
      )
      .orderBy(desc(principalHistoryPrefixes.version))
      .limit(1);
    if (prefix) encoded.push(prefix.envelopes);
    const [stage] = await db
      .select({
        envelopes: sql<string>`json_extract(${principalHistoryStages.currentJson}, '$.currentMemberEnvelopes')`,
      })
      .from(principalHistoryStages)
      .where(
        and(
          eq(
            principalCurrentFingerprintJson(principalHistoryStages.currentJson),
            fingerprint,
          ),
          eq(principalHistoryStages.complete, true),
        ),
      )
      .orderBy(desc(principalHistoryStages.afterVersion))
      .limit(1);
    if (stage) encoded.push(stage.envelopes);
    for (const json of encoded) {
      let envelopes: unknown;
      try {
        envelopes = JSON.parse(json);
      } catch {
        continue;
      }
      if (!isCurrentPrincipalMemberEnvelopesResponse(envelopes)) continue;
      candidates.push({
        currentState: {
          principalType: envelopes.principalType,
          principalId: envelopes.principalId,
          stateHash: envelopes.stateHash,
          keyFingerprint: fingerprint,
        },
        currentMemberEnvelopes: envelopes,
      });
    }
  }
  return candidates;
}
