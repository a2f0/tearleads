import {
  KeyingVerificationError,
  PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT,
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicyHistoryReferenceProof,
  type ReferencedPrincipalHead,
  selectPrincipalPolicyAuthorization,
  type VerifiedPrincipalPolicySelection,
  verifyPrincipalPolicyCheckpoint,
  verifyPrincipalPolicyHistoryReferences,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { loadPrincipalHistoryReference } from "../../data/persistence/principalHistoryEvidencePersistence";
import { principalHeadMatchesReference } from "../../data/principals/organizationAuthorityDescriptor";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { PrincipalHistoryEvidenceUnavailableError } from "./principalHistoryRecoveryReferences";
import type { RecoveredPublicPrincipalHistory } from "./publicPrincipalHistoryTypes";

interface PublicHistorySelectionInput {
  readonly execSql: ExecSql;
  readonly recovered: RecoveredPublicPrincipalHistory;
  readonly references: readonly ReferencedPrincipalHead[];
  readonly checkpoint: PrincipalPolicyCheckpoint | null;
  readonly includeGenesis?: boolean;
  readonly stillCurrent: () => boolean;
}

async function selectBatch(
  input: PublicHistorySelectionInput,
  versions: readonly number[],
  checkpointReference: PrincipalPolicyHistoryReferenceProof | undefined,
) {
  const proofs: PrincipalPolicyHistoryReferenceProof[] = [];
  for (const version of versions) {
    assertProjectionVerificationCurrent(input.stillCurrent);
    proofs.push(
      await loadPrincipalHistoryReference({
        execSql: input.execSql,
        ...input.recovered,
        version,
      }),
    );
  }
  const selected = await verifyPrincipalPolicyHistoryReferences({
    history: input.recovered.history,
    references: proofs,
    checkpointReference,
  });
  if (!selected.ok) throw selected.error;
  return selected.value;
}

async function loadCheckpointProof(
  input: PublicHistorySelectionInput,
  checkpoint: PrincipalPolicyCheckpoint | null,
): Promise<PrincipalPolicyHistoryReferenceProof | undefined> {
  let checkpointReference: PrincipalPolicyHistoryReferenceProof | undefined;
  try {
    if (checkpoint)
      checkpointReference = await loadPrincipalHistoryReference({
        execSql: input.execSql,
        ...input.recovered,
        version: checkpoint.version,
      });
  } catch (error) {
    if (error instanceof KeyingVerificationError)
      throw new PrincipalHistoryEvidenceUnavailableError(error);
    throw error;
  }
  return checkpointReference;
}

/** Select bounded proof batches without admitting or advancing durable pins. */
export async function selectPublicPrincipalHistory(
  input: PublicHistorySelectionInput,
): Promise<VerifiedPrincipalPolicySelection[]> {
  const references = structuredClone(input.references);
  const checkpoint = input.checkpoint && { ...input.checkpoint };
  const head = input.recovered.history.currentEntry.state;
  if (checkpoint && checkpoint.version > head.version)
    throw new KeyingVerificationError(
      "missing_dependency",
      "Public history cannot connect to the newer durable checkpoint",
    );
  if (
    references.some(
      (reference) =>
        reference.principalType !== head.principalType ||
        reference.principalId !== head.principalId ||
        reference.version > head.version,
    )
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Public history reference is outside the verified prefix",
    );
  const versions = [
    ...new Set([
      ...(input.includeGenesis ? [1] : []),
      ...references.map(({ version }) => version),
      head.version,
    ]),
  ];
  const policies: VerifiedPrincipalPolicySelection[] = [];
  const checkpointReference = await loadCheckpointProof(input, checkpoint);
  for (
    let offset = 0;
    offset < versions.length;
    offset += PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT
  ) {
    const batch = versions.slice(
      offset,
      offset + PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT,
    );
    const selected = await selectBatch(input, batch, checkpointReference).catch(
      (error: unknown) => {
        if (error instanceof KeyingVerificationError)
          throw new PrincipalHistoryEvidenceUnavailableError(error);
        throw error;
      },
    );
    // Authenticate the disposable proof before comparing caller citations or pins.
    for (const reference of references.filter(({ version }) =>
      batch.includes(version),
    ))
      if (
        !selected.retainedEntries.some(({ state }) =>
          principalHeadMatchesReference(state, reference),
        )
      )
        throw new KeyingVerificationError(
          "object_mismatch",
          "Public history citation differs from its verified entry",
        );
    verifyPrincipalPolicyCheckpoint({
      chain: selected.retainedEntries.map((entry) => ({
        ...entry,
        projection: [...entry.projection],
        grants: [...entry.grants],
      })),
      currentState: selected.currentEntry.state,
      localCheckpoint: checkpoint,
    });
    const policy = await selectPrincipalPolicyAuthorization(selected);
    if (!policy.ok) throw policy.error;
    policies.push(policy.value);
  }
  assertProjectionVerificationCurrent(input.stillCurrent);
  return policies;
}
