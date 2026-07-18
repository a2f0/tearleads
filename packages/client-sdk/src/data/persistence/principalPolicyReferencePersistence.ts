import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { isPrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import {
  principalPolicies,
  principalPolicyBundleHistory,
} from "../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../sqlite/sqlSchema";
import { ensurePrincipalPolicyTables } from "./principalPolicyPersistence";

interface SelectedPrincipalPolicyRow {
  readonly currentMemberEnvelopesJson: string;
  readonly currentPayloadJson: string;
  readonly currentProjectionJson: string;
  readonly currentStateJson: string;
  readonly previousStatesJson: string;
  readonly principalId: string;
  readonly principalType: string;
  readonly stateHash: string;
}

const currentBundleSelection = {
  currentMemberEnvelopesJson: principalPolicies.currentMemberEnvelopesJson,
  currentPayloadJson: principalPolicies.currentPayloadJson,
  currentProjectionJson: principalPolicies.currentProjectionJson,
  currentStateJson: principalPolicies.currentStateJson,
  previousStatesJson: principalPolicies.previousStatesJson,
  principalId: principalPolicies.principalId,
  principalType: principalPolicies.principalType,
  stateHash: principalPolicies.stateHash,
};

const retainedBundleSelection = {
  currentMemberEnvelopesJson:
    principalPolicyBundleHistory.currentMemberEnvelopesJson,
  currentPayloadJson: principalPolicyBundleHistory.currentPayloadJson,
  currentProjectionJson: principalPolicyBundleHistory.currentProjectionJson,
  currentStateJson: principalPolicyBundleHistory.currentStateJson,
  previousStatesJson: principalPolicyBundleHistory.previousStatesJson,
  principalId: principalPolicyBundleHistory.principalId,
  principalType: principalPolicyBundleHistory.principalType,
  stateHash: principalPolicyBundleHistory.stateHash,
};

function parseBoundBundle(
  row: SelectedPrincipalPolicyRow,
): PrincipalPolicyBundleResponse {
  const bundle: unknown = {
    currentMemberEnvelopes: JSON.parse(row.currentMemberEnvelopesJson),
    currentPayload: JSON.parse(row.currentPayloadJson),
    currentProjection: JSON.parse(row.currentProjectionJson),
    currentState: JSON.parse(row.currentStateJson),
    previousStates: JSON.parse(row.previousStatesJson),
  };
  if (!isPrincipalPolicyBundleResponse(bundle)) {
    throw new Error("Stored principal policy bundle is invalid");
  }
  if (
    bundle.currentState.principalType !== row.principalType ||
    bundle.currentState.principalId !== row.principalId ||
    bundle.currentState.stateHash !== row.stateHash
  ) {
    throw new Error("Stored principal policy bundle row binding is invalid");
  }
  return bundle;
}

function bundleContainsReference(
  bundle: PrincipalPolicyBundleResponse,
  reference: ReferencedPrincipalHead,
): boolean {
  return [
    ...bundle.previousStates.map(({ state }) => state),
    bundle.currentState,
  ].some(
    (state) =>
      state.principalType === reference.principalType &&
      state.principalId === reference.principalId &&
      state.version === reference.version &&
      state.stateHash === reference.stateHash &&
      state.keyEpoch === reference.keyEpoch &&
      state.keyFingerprint === reference.keyFingerprint,
  );
}

function selectNewestBundleForReference(
  rows: ReadonlyArray<SelectedPrincipalPolicyRow>,
  reference: ReferencedPrincipalHead,
): PrincipalPolicyBundleResponse | null {
  let selected: PrincipalPolicyBundleResponse | null = null;
  for (const row of rows) {
    const bundle = parseBoundBundle(row);
    if (!bundleContainsReference(bundle, reference)) {
      if (row.stateHash === reference.stateHash) {
        throw new Error("Stored principal policy bundle head does not match");
      }
      continue;
    }
    if (
      !selected ||
      bundle.currentState.version > selected.currentState.version
    ) {
      selected = bundle;
    } else if (
      bundle.currentState.version === selected.currentState.version &&
      bundle.currentState.stateHash !== selected.currentState.stateHash
    ) {
      throw new Error(
        "Stored principal policy bundles conflict at one version",
      );
    }
  }
  return selected;
}

export async function loadPrincipalPolicyBundleForReference(
  execSql: ExecSql,
  reference: ReferencedPrincipalHead,
): Promise<PrincipalPolicyBundleResponse | null> {
  await ensurePrincipalPolicyTables(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [currentRow] = await db
    .select(currentBundleSelection)
    .from(principalPolicies)
    .where(
      and(
        eq(principalPolicies.principalType, reference.principalType),
        eq(principalPolicies.principalId, reference.principalId),
      ),
    )
    .limit(1);
  const retainedRows = await db
    .select(retainedBundleSelection)
    .from(principalPolicyBundleHistory)
    .where(
      and(
        eq(principalPolicyBundleHistory.principalType, reference.principalType),
        eq(principalPolicyBundleHistory.principalId, reference.principalId),
      ),
    );
  return selectNewestBundleForReference(
    currentRow ? [currentRow, ...retainedRows] : retainedRows,
    reference,
  );
}
