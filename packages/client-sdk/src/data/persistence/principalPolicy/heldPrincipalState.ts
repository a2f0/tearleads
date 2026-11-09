import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import {
  isPrincipalStateResponse,
  type PrincipalStateResponse,
} from "@tearleads/validators/response";
import { and, eq, inArray } from "drizzle-orm";
import { principalHeadMatchesReference } from "../../principals/organizationAuthorityDescriptor";
import {
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyBundleReferences,
} from "../../sqlite/schema";
import {
  principalHistoryEntries,
  principalHistoryEntryStateHashJson,
} from "../../sqlite/schema/principalHistoryEvidenceSchema";
import {
  type ClientSQLiteDatabase,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { ensurePrincipalPolicyTables } from "./principalPolicyPersistence";

/** Candidate rows per source; equal hashes rarely repeat across scopes. */
const HELD_STATE_CANDIDATES = 8;

function parsedJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function stateOf(entry: unknown): unknown {
  return entry && typeof entry === "object"
    ? Reflect.get(entry, "state")
    : null;
}

function exactState(
  state: unknown,
  head: ReferencedPrincipalHead,
): PrincipalStateResponse | null {
  return isPrincipalStateResponse(state) &&
    principalHeadMatchesReference(state, head)
    ? state
    : null;
}

/** States this device stored as signed history evidence, by state hash. */
async function evidenceState(
  db: ClientSQLiteDatabase,
  head: ReferencedPrincipalHead,
): Promise<PrincipalStateResponse | null> {
  const rows = await db
    .select({ entryJson: principalHistoryEntries.entryJson })
    .from(principalHistoryEntries)
    .where(
      eq(
        principalHistoryEntryStateHashJson(principalHistoryEntries.entryJson),
        head.stateHash,
      ),
    )
    .limit(HELD_STATE_CANDIDATES);
  for (const { entryJson } of rows) {
    const state = exactState(stateOf(parsedJson(entryJson)), head);
    if (state) return state;
  }
  return null;
}

/** A bundle row holds the head itself, or a predecessor at its version index. */
function bundleRowState(
  row: {
    readonly stateHash: string;
    readonly currentStateJson: string;
    readonly previousStatesJson: string;
  },
  head: ReferencedPrincipalHead,
): unknown {
  if (row.stateHash === head.stateHash) return parsedJson(row.currentStateJson);
  const previous = parsedJson(row.previousStatesJson);
  return Array.isArray(previous) ? stateOf(previous[head.version - 1]) : null;
}

/** States in a cached policy bundle chain: its head, or a predecessor the reference index names. */
async function bundleState(
  db: ClientSQLiteDatabase,
  head: ReferencedPrincipalHead,
): Promise<PrincipalStateResponse | null> {
  const indexed = await db
    .selectDistinct({
      bundleStateHash: principalPolicyBundleReferences.bundleStateHash,
    })
    .from(principalPolicyBundleReferences)
    .where(
      and(
        eq(principalPolicyBundleReferences.principalType, head.principalType),
        eq(principalPolicyBundleReferences.principalId, head.principalId),
        eq(principalPolicyBundleReferences.version, head.version),
        eq(principalPolicyBundleReferences.stateHash, head.stateHash),
        eq(principalPolicyBundleReferences.keyEpoch, head.keyEpoch),
        eq(principalPolicyBundleReferences.keyFingerprint, head.keyFingerprint),
      ),
    )
    .limit(HELD_STATE_CANDIDATES);
  const bundleStateHashes = [
    head.stateHash,
    ...indexed.map(({ bundleStateHash }) => bundleStateHash),
  ];
  for (const table of [principalPolicies, principalPolicyBundleHistory]) {
    const rows = await db
      .select({
        stateHash: table.stateHash,
        currentStateJson: table.currentStateJson,
        previousStatesJson: table.previousStatesJson,
      })
      .from(table)
      .where(
        and(
          eq(table.principalType, head.principalType),
          eq(table.principalId, head.principalId),
          inArray(table.stateHash, bundleStateHashes),
        ),
      );
    for (const row of rows) {
      const state = exactState(bundleRowState(row, head), head);
      if (state) return state;
    }
  }
  return null;
}

/**
 * A signed state this device stored for exactly `head`: history evidence it
 * verified or acknowledged, or a cached policy bundle chain. It is untrusted;
 * the caller verifies it as it would a served copy, and a miss only means the
 * server sends one.
 */
export async function loadHeldPrincipalState(
  execSql: ExecSql,
  head: ReferencedPrincipalHead,
): Promise<PrincipalStateResponse | null> {
  await ensurePrincipalPolicyTables(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  return (await evidenceState(db, head)) ?? bundleState(db, head);
}
