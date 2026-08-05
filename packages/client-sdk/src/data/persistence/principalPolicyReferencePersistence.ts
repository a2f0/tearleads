import {
  KeyingVerificationError,
  type PrincipalPolicyCheckpoint,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  isPrincipalPolicyBundleResponse,
  isReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import { and, eq, inArray } from "drizzle-orm";
import {
  principalPolicyBundleContainsReference,
  principalPolicyBundleStates,
} from "../principalPolicyStates";
import {
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyBundleReferences,
} from "../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../sqlite/sqlSchema";
import { assertSameHeadPrincipalPolicyBundle } from "./principalPolicyBundleIntegrity";
import { ensurePrincipalPolicyTables } from "./principalPolicyPersistence";
import { applyPrincipalPolicyReferenceCheckpoint } from "./principalPolicyReferenceCheckpoint";

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

interface IndexedBundleHead {
  readonly bundleStateHash: string;
  readonly bundleVersion: number;
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

function assertUnambiguousBundleChain(
  bundle: PrincipalPolicyBundleResponse,
): void {
  const states = principalPolicyBundleStates(bundle);
  if (states.length !== bundle.currentState.version) {
    throw new KeyingVerificationError(
      "missing_dependency",
      "stored principal policy bundle chain length does not match its head",
    );
  }
  const versions = new Map<number, string>();
  for (const [index, state] of states.entries()) {
    if (
      state.principalType !== bundle.currentState.principalType ||
      state.principalId !== bundle.currentState.principalId
    ) {
      throw new KeyingVerificationError(
        "object_mismatch",
        "stored principal policy bundle chain belongs to another principal",
      );
    }
    if (
      !Number.isInteger(state.version) ||
      state.version !== index + 1 ||
      !Number.isInteger(state.keyEpoch) ||
      state.keyEpoch < 1 ||
      state.principalId.length === 0 ||
      state.stateHash.length === 0 ||
      state.keyFingerprint.length === 0
    ) {
      throw new KeyingVerificationError(
        "invalid_shape",
        "stored principal policy bundle chain has an invalid version or epoch",
      );
    }
    if (versions.has(state.version)) {
      const previousHash = versions.get(state.version);
      throw new KeyingVerificationError(
        previousHash === state.stateHash ? "duplicate_entry" : "equivocation",
        "stored principal policy bundle chain repeats a version",
      );
    }
    versions.set(state.version, state.stateHash);
  }
}

function parseBoundBundle(
  row: SelectedPrincipalPolicyRow,
): PrincipalPolicyBundleResponse {
  let bundle: unknown;
  try {
    bundle = {
      currentMemberEnvelopes: JSON.parse(row.currentMemberEnvelopesJson),
      currentPayload: JSON.parse(row.currentPayloadJson),
      currentProjection: JSON.parse(row.currentProjectionJson),
      currentState: JSON.parse(row.currentStateJson),
      previousStates: JSON.parse(row.previousStatesJson),
    };
  } catch {
    throw new KeyingVerificationError(
      "invalid_shape",
      "stored principal policy bundle contains malformed JSON",
    );
  }
  if (!isPrincipalPolicyBundleResponse(bundle)) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "stored principal policy bundle is invalid",
    );
  }
  if (
    bundle.currentState.principalType !== row.principalType ||
    bundle.currentState.principalId !== row.principalId
  ) {
    throw new KeyingVerificationError(
      "object_mismatch",
      "stored principal policy bundle row belongs to another principal",
    );
  }
  if (bundle.currentState.stateHash !== row.stateHash) {
    throw new KeyingVerificationError(
      "hash_mismatch",
      "stored principal policy bundle row has a different head hash",
    );
  }
  assertUnambiguousBundleChain(bundle);
  return bundle;
}

function assertIndexedBundle(
  bundle: PrincipalPolicyBundleResponse,
  indexed: IndexedBundleHead,
  reference: ReferencedPrincipalHead,
): void {
  if (
    bundle.currentState.stateHash !== indexed.bundleStateHash ||
    bundle.currentState.version !== indexed.bundleVersion
  ) {
    throw new KeyingVerificationError(
      "equivocation",
      "principal policy reference index conflicts with its bundle head",
    );
  }
  if (!principalPolicyBundleContainsReference(bundle, reference)) {
    throw new KeyingVerificationError(
      "hash_mismatch",
      "indexed principal policy bundle does not contain the exact reference",
    );
  }
}

function addCandidate(
  candidates: Map<
    string,
    { bundle: PrincipalPolicyBundleResponse; row: SelectedPrincipalPolicyRow }
  >,
  bundle: PrincipalPolicyBundleResponse,
  row: SelectedPrincipalPolicyRow,
): void {
  const existing = candidates.get(bundle.currentState.stateHash);
  if (existing) {
    assertSameHeadPrincipalPolicyBundle(existing.row, row);
    return;
  }
  candidates.set(bundle.currentState.stateHash, { bundle, row });
}

function assertCurrentDoesNotConflict(
  bundle: PrincipalPolicyBundleResponse,
  reference: ReferencedPrincipalHead,
): void {
  if (bundle.currentState.version < reference.version) {
    return;
  }
  const stateAtReference = principalPolicyBundleStates(bundle).find(
    (state) => state.version === reference.version,
  );
  if (!stateAtReference) {
    throw new KeyingVerificationError(
      "stale_predecessor",
      "current principal policy chain omits the referenced version",
    );
  }
  if (stateAtReference.stateHash !== reference.stateHash) {
    throw new KeyingVerificationError(
      "equivocation",
      "current principal policy chain conflicts with the referenced version",
    );
  }
  throw new KeyingVerificationError(
    "hash_mismatch",
    "current principal policy state does not match the exact reference",
  );
}

function selectNewestCandidate(
  candidates: ReadonlyMap<
    string,
    { readonly bundle: PrincipalPolicyBundleResponse }
  >,
): PrincipalPolicyBundleResponse | null {
  let selected: PrincipalPolicyBundleResponse | null = null;
  const stateHashByVersion = new Map<number, string>();
  for (const { bundle } of candidates.values()) {
    const existingHash = stateHashByVersion.get(bundle.currentState.version);
    if (
      existingHash !== undefined &&
      existingHash !== bundle.currentState.stateHash
    ) {
      throw new KeyingVerificationError(
        "equivocation",
        "stored principal policy bundles conflict at one version",
      );
    }
    stateHashByVersion.set(
      bundle.currentState.version,
      bundle.currentState.stateHash,
    );
    if (
      !selected ||
      bundle.currentState.version > selected.currentState.version
    ) {
      selected = bundle;
    }
  }
  return selected;
}

function assertReferenceShape(reference: ReferencedPrincipalHead): void {
  if (!isReferencedPrincipalStateResponse(reference)) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "principal policy reference is malformed",
    );
  }
  if (
    !Number.isInteger(reference.version) ||
    reference.version < 1 ||
    !Number.isInteger(reference.keyEpoch) ||
    reference.keyEpoch < 1 ||
    reference.principalId.length === 0 ||
    reference.stateHash.length === 0 ||
    reference.keyFingerprint.length === 0
  ) {
    throw new KeyingVerificationError(
      "invalid_shape",
      "principal policy reference is malformed",
    );
  }
}

async function loadCurrentRow(
  execSql: ExecSql,
  reference: ReferencedPrincipalHead,
): Promise<SelectedPrincipalPolicyRow | undefined> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [row] = await db
    .select(currentBundleSelection)
    .from(principalPolicies)
    .where(
      and(
        eq(principalPolicies.principalType, reference.principalType),
        eq(principalPolicies.principalId, reference.principalId),
      ),
    )
    .limit(1);
  return row;
}

async function loadIndexedHeads(
  execSql: ExecSql,
  reference: ReferencedPrincipalHead,
): Promise<IndexedBundleHead[]> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  return db
    .select({
      bundleStateHash: principalPolicyBundleReferences.bundleStateHash,
      bundleVersion: principalPolicyBundleReferences.bundleVersion,
    })
    .from(principalPolicyBundleReferences)
    .where(
      and(
        eq(
          principalPolicyBundleReferences.principalType,
          reference.principalType,
        ),
        eq(principalPolicyBundleReferences.principalId, reference.principalId),
        eq(principalPolicyBundleReferences.version, reference.version),
        eq(principalPolicyBundleReferences.stateHash, reference.stateHash),
        eq(principalPolicyBundleReferences.keyEpoch, reference.keyEpoch),
        eq(
          principalPolicyBundleReferences.keyFingerprint,
          reference.keyFingerprint,
        ),
      ),
    );
}

function indexHeadsByHash(
  heads: readonly IndexedBundleHead[],
): Map<string, IndexedBundleHead> {
  const stateHashByVersion = new Map<number, string>();
  for (const head of heads) {
    if (
      !Number.isInteger(head.bundleVersion) ||
      head.bundleVersion < 1 ||
      head.bundleStateHash.length === 0
    ) {
      throw new KeyingVerificationError(
        "invalid_shape",
        "principal policy reference index is malformed",
      );
    }
    const indexedHash = stateHashByVersion.get(head.bundleVersion);
    if (indexedHash !== undefined && indexedHash !== head.bundleStateHash) {
      throw new KeyingVerificationError(
        "equivocation",
        "principal policy reference index has conflicting bundle heads at one version",
      );
    }
    stateHashByVersion.set(head.bundleVersion, head.bundleStateHash);
  }
  return new Map(heads.map((head) => [head.bundleStateHash, head]));
}

async function loadRetainedRows(
  execSql: ExecSql,
  reference: ReferencedPrincipalHead,
  currentRow: SelectedPrincipalPolicyRow | undefined,
  indexedByHash: ReadonlyMap<string, IndexedBundleHead>,
): Promise<SelectedPrincipalPolicyRow[]> {
  const hashes = new Set([reference.stateHash, ...indexedByHash.keys()]);
  if (currentRow) {
    hashes.delete(currentRow.stateHash);
  }
  if (hashes.size === 0) {
    return [];
  }
  // Remote reset deliberately clears mutable heads while retaining historical
  // key material, so an index target can outlive its bundle row. Such a target
  // is only a selection hint; rows that still exist remain authoritative.
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  return db
    .select(retainedBundleSelection)
    .from(principalPolicyBundleHistory)
    .where(
      and(
        eq(principalPolicyBundleHistory.principalType, reference.principalType),
        eq(principalPolicyBundleHistory.principalId, reference.principalId),
        inArray(principalPolicyBundleHistory.stateHash, [...hashes]),
      ),
    );
}

function collectCandidates(
  currentRow: SelectedPrincipalPolicyRow | undefined,
  retainedRows: readonly SelectedPrincipalPolicyRow[],
  indexedByHash: ReadonlyMap<string, IndexedBundleHead>,
  reference: ReferencedPrincipalHead,
) {
  const candidates = new Map<
    string,
    { bundle: PrincipalPolicyBundleResponse; row: SelectedPrincipalPolicyRow }
  >();
  if (currentRow) {
    const bundle = parseBoundBundle(currentRow);
    const indexed = indexedByHash.get(currentRow.stateHash);
    if (indexed) {
      assertIndexedBundle(bundle, indexed, reference);
    }
    if (principalPolicyBundleContainsReference(bundle, reference)) {
      addCandidate(candidates, bundle, currentRow);
    } else {
      assertCurrentDoesNotConflict(bundle, reference);
    }
  }
  for (const row of retainedRows) {
    const bundle = parseBoundBundle(row);
    const indexed = indexedByHash.get(row.stateHash);
    if (indexed) {
      assertIndexedBundle(bundle, indexed, reference);
    } else if (!principalPolicyBundleContainsReference(bundle, reference)) {
      throw new KeyingVerificationError(
        "hash_mismatch",
        "stored principal policy bundle head does not match the exact reference",
      );
    }
    addCandidate(candidates, bundle, row);
  }
  return candidates;
}

export async function loadPrincipalPolicyBundleForReference(
  execSql: ExecSql,
  reference: ReferencedPrincipalHead,
  checkpoint: PrincipalPolicyCheckpoint | null,
): Promise<PrincipalPolicyBundleResponse | null> {
  assertReferenceShape(reference);
  await ensurePrincipalPolicyTables(execSql);
  const [currentRow, indexedHeads] = await Promise.all([
    loadCurrentRow(execSql, reference),
    loadIndexedHeads(execSql, reference),
  ]);
  const indexedByHash = indexHeadsByHash(indexedHeads);
  const retainedRows = await loadRetainedRows(
    execSql,
    reference,
    currentRow,
    indexedByHash,
  );
  const candidates = collectCandidates(
    currentRow,
    retainedRows,
    indexedByHash,
    reference,
  );
  const selected = selectNewestCandidate(candidates);
  return selected
    ? applyPrincipalPolicyReferenceCheckpoint(selected, checkpoint)
    : null;
}
