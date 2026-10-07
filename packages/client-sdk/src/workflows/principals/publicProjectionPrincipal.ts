import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { PrincipalHistoryEvidenceUnavailableError } from "./principalHistoryRecoveryReferences";
import type {
  PublicPrincipalHistoryOptions,
  RecoveredPublicPrincipalHistory,
} from "./publicPrincipalHistoryTypes";
import { recoverPublicPrincipalHistory } from "./recoverPublicPrincipalHistory";
import { selectPublicPrincipalHistory } from "./selectPublicPrincipalHistory";

export interface PublicProjectionPrincipal {
  readonly options: PublicPrincipalHistoryOptions;
  readonly references: readonly ReferencedPrincipalHead[];
  recovered: RecoveredPublicPrincipalHistory;
  replayed: boolean;
}

/** The source head and every citation remain bound independently of a newer prefix. */
export async function selectPublicProjectionPrincipal(
  principal: PublicProjectionPrincipal,
  references: readonly ReferencedPrincipalHead[] = principal.references,
) {
  const { options } = principal;
  const current = () => !options.signal?.aborted && options.stillCurrent();
  assertProjectionVerificationCurrent(current);
  const checkpoint = await loadPrincipalPolicyCheckpoint(
    options.execSql,
    options.source.head.principalType,
    options.source.head.principalId,
  );
  try {
    return await selectPublicPrincipalHistory({
      execSql: options.execSql,
      recovered: principal.recovered,
      references: [options.source.head, ...references],
      checkpoint,
      includeGenesis: options.source.head.principalType === "organization",
      stillCurrent: current,
    });
  } catch (error) {
    if (!(error instanceof PrincipalHistoryEvidenceUnavailableError))
      throw error;
    if (options.offline || principal.replayed) throw error.verificationError;
    principal.replayed = true;
    principal.recovered = await recoverPublicPrincipalHistory({
      ...options,
      replay: true,
    });
    return selectPublicProjectionPrincipal(principal, references);
  }
}

export async function recoverPublicProjectionPrincipal(
  options: PublicPrincipalHistoryOptions,
  references: readonly ReferencedPrincipalHead[],
): Promise<PublicProjectionPrincipal> {
  const selected = references.filter(
    (head) =>
      head.principalType === options.source.head.principalType &&
      head.principalId === options.source.head.principalId,
  );
  if (selected.some((head) => head.version > options.source.head.version))
    rejectPublicProjection("citation exceeds its supplied source head");
  const principal = {
    options,
    references: structuredClone(selected),
    recovered: await recoverPublicPrincipalHistory(options),
    replayed: false,
  };
  await selectPublicProjectionPrincipal(principal);
  return principal;
}

export function rejectPublicProjection(message: string): never {
  throw new KeyingVerificationError(
    "object_mismatch",
    `Public projection history: ${message}`,
  );
}
