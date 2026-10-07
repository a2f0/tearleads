import {
  KeyingVerificationError,
  type PrincipalPolicyHistoryReferenceProof,
  type PrincipalPolicyStateChainEntry,
  verifyPrincipalPolicyHistoryReferences,
} from "@tearleads/crypto";
import {
  isPrincipalPolicyStateChainEntryResponse,
  PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE,
  type PrincipalPolicyStateChainEntryResponse,
} from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { loadPrincipalHistoryReference } from "../../data/persistence/principalHistoryEvidencePersistence";
import { principalHistoryEvidenceScopeId } from "../../data/principals/principalHistoryPrefixProtection";
import { ownPrincipalHistoryProtection } from "../../data/principals/principalHistoryProtection";
import { loadVerifiedPrincipalHistoryPrefix } from "./principalHistoryRecoveryPrefix";
import { PrincipalHistoryEvidenceUnavailableError } from "./principalHistoryRecoveryReferences";
import {
  PrincipalHistoryRecoveryRaceError,
  type RecoverPrincipalPolicyHistoryOptions,
} from "./principalHistoryRecoveryTypes";
import { principalHistoryVerificationContext } from "./principalHistoryRecoveryVerification";

export interface RecoveredPrincipalHistoryPage {
  /** Ascending entries, with the immediate predecessor kept separately for diffs. */
  readonly entries: readonly PrincipalPolicyStateChainEntryResponse[];
  readonly predecessor: PrincipalPolicyStateChainEntryResponse | null;
  readonly nextBeforeVersion: number | null;
}

/** Read a bounded historical window from an already recovered, exact private root. */
export async function loadRecoveredPrincipalHistoryPage(
  options: RecoverPrincipalPolicyHistoryOptions,
  beforeVersion = options.expectedHead.version + 1,
): Promise<RecoveredPrincipalHistoryPage> {
  const owned = {
    ...options,
    expectedHead: structuredClone(options.expectedHead),
    protection: ownPrincipalHistoryProtection(options.protection),
  };
  try {
    return await readPage(owned, beforeVersion);
  } finally {
    owned.protection.localKey.fill(0);
  }
}

async function readPage(
  options: RecoverPrincipalPolicyHistoryOptions,
  beforeVersion: number,
): Promise<RecoveredPrincipalHistoryPage> {
  if (
    !Number.isSafeInteger(beforeVersion) ||
    beforeVersion <= 1 ||
    beforeVersion > options.expectedHead.version + 1
  )
    throw new KeyingVerificationError(
      "invalid_shape",
      "Principal history page cursor is outside the selected history",
    );
  const current = () => !options.signal?.aborted && options.stillCurrent();
  assertProjectionVerificationCurrent(current);
  const { scopeId, history } = await restoreReadRoot(options, current);
  const checkpoint = await loadPrincipalPolicyCheckpoint(
    options.execSql,
    options.expectedHead.principalType,
    options.expectedHead.principalId,
  );
  if (checkpoint && checkpoint.version > options.expectedHead.version)
    throw new PrincipalHistoryRecoveryRaceError(
      "Principal checkpoint advanced beyond the selected display history",
    );
  const load = (version: number) =>
    loadPageReference({
      execSql: options.execSql,
      scopeId,
      history,
      version,
    });
  const firstVersion = Math.max(
    1,
    beforeVersion - PRINCIPAL_DISPLAY_HISTORY_PAGE_SIZE,
  );
  const references: PrincipalPolicyHistoryReferenceProof[] = [];
  for (
    let version = Math.max(1, firstVersion - 1);
    version < beforeVersion;
    version += 1
  ) {
    assertProjectionVerificationCurrent(current);
    references.push(await load(version));
  }
  const checkpointReference = checkpoint
    ? await load(checkpoint.version)
    : undefined;
  if (
    checkpointReference &&
    checkpointReference.reference.stateHash !== checkpoint?.stateHash
  )
    throw new KeyingVerificationError(
      "equivocation",
      "Principal history page conflicts with its durable checkpoint",
    );
  const selected = await verifyPrincipalPolicyHistoryReferences({
    history,
    references,
    checkpointReference,
  });
  if (!selected.ok)
    throw new PrincipalHistoryEvidenceUnavailableError(selected.error);
  await assertDisplayCheckpointCurrent(options, checkpoint);
  assertProjectionVerificationCurrent(current);
  // These exact rows passed inclusion and commitment verification above. Keep
  // their display-only server timestamps, which the private current strips.
  const retained = references.map(({ entry }) => responseEntry(entry));
  return {
    entries: retained.filter(
      ({ state }) =>
        state.version >= firstVersion && state.version < beforeVersion,
    ),
    predecessor:
      retained.find(({ state }) => state.version === firstVersion - 1) ?? null,
    nextBeforeVersion: firstVersion > 1 ? firstVersion : null,
  };
}

async function assertDisplayCheckpointCurrent(
  options: RecoverPrincipalPolicyHistoryOptions,
  checkpoint: Awaited<ReturnType<typeof loadPrincipalPolicyCheckpoint>>,
) {
  const latest = await loadPrincipalPolicyCheckpoint(
    options.execSql,
    options.expectedHead.principalType,
    options.expectedHead.principalId,
  );
  if (
    latest?.version !== checkpoint?.version ||
    latest?.stateHash !== checkpoint?.stateHash
  )
    throw new PrincipalHistoryRecoveryRaceError(
      "Principal checkpoint changed while reading display history",
    );
}

async function loadPageReference(
  input: Parameters<typeof loadPrincipalHistoryReference>[0],
) {
  try {
    return await loadPrincipalHistoryReference(input);
  } catch (error) {
    if (error instanceof KeyingVerificationError)
      throw new PrincipalHistoryEvidenceUnavailableError(error);
    throw error;
  }
}

function responseEntry(
  entry: PrincipalPolicyStateChainEntry,
): PrincipalPolicyStateChainEntryResponse {
  if (!isPrincipalPolicyStateChainEntryResponse(entry))
    throw new KeyingVerificationError(
      "missing_dependency",
      "Principal history display metadata is unavailable",
    );
  return entry;
}

async function restoreReadRoot(
  options: RecoverPrincipalPolicyHistoryOptions,
  current: () => boolean,
) {
  const normalized = {
    ...options,
    protection: {
      ...options.protection,
      context: principalHistoryVerificationContext(options),
    },
  };
  const scopeId = await principalHistoryEvidenceScopeId({
    organizationId: options.organizationId,
    head: options.expectedHead,
    protection: normalized.protection,
  });
  const prefix = await loadVerifiedPrincipalHistoryPrefix(
    normalized,
    {
      principalType: options.expectedHead.principalType,
      principalId: options.expectedHead.principalId,
    },
    scopeId,
  );
  assertProjectionVerificationCurrent(current);
  if (!prefix)
    throw new KeyingVerificationError(
      "missing_dependency",
      "Principal history page requires a recovered private prefix",
    );
  const finished = prefix.verifier.finish(options.expectedHead);
  if (!finished.ok) throw finished.error;
  return { scopeId, history: finished.value };
}
