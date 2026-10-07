import {
  createPrincipalPolicyHistoryVerifier,
  KeyingVerificationError,
  type PrincipalPolicyExternalAuthority,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { ownPrincipalHistoryProtection } from "../../data/principals/principalHistoryProtection";
import { scopedGroupHistoryProtection } from "../../data/principals/principalHistoryScopeProtection";
import {
  PrincipalHistoryRecoveryRaceError,
  type RecoveredPrincipalPolicyHistory,
} from "./principalHistoryRecoveryTypes";
import {
  type PrincipalRecoveryContext,
  PrincipalRecoveryDirectoryAdvanced,
  type RecoveredPolicyDirectory,
} from "./principalRecoveryDirectory";
import {
  createPrincipalRecoveryReader,
  type PrincipalRecoveryMemo,
} from "./principalRecoveryMemo";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

export interface RecoverScopedPrincipalPolicyHistoryOptions
  extends PrincipalRecoveryContext {
  readonly reference: ReferencedPrincipalHead;
}

export interface RecoveredScopedPrincipalPolicyHistory
  extends RecoveredPrincipalPolicyHistory {
  /** Submit these with policy when atomically admitting its organization scope. */
  readonly dependencies: readonly VerifiedPrincipalPolicyCurrent[];
}

function groupHead(directory: RecoveredPolicyDirectory, principalId: string) {
  const head = directory.descriptor.groupHeads.find(
    (entry) => entry.principalId === principalId,
  );
  if (!head)
    throw new KeyingVerificationError(
      "missing_dependency",
      "Group is absent from the signed organization directory",
    );
  return head;
}

function authorityHead(state: ReferencedPrincipalHead) {
  return {
    principalType: "group" as const,
    principalId: state.principalId,
    version: state.version,
    stateHash: state.stateHash,
    keyEpoch: state.keyEpoch,
    keyFingerprint: state.keyFingerprint,
  };
}

async function recoverScopedPolicy(
  input: RecoverScopedPrincipalPolicyHistoryOptions,
  memo?: PrincipalRecoveryMemo,
): Promise<RecoveredScopedPrincipalPolicyHistory> {
  if (
    input.reference.principalType === "organization" &&
    input.reference.principalId !== input.organizationId
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Requested organization policy is outside its scope",
    );
  const read = createPrincipalRecoveryReader(input, memo);
  const directory = await read.directory(
    input.reference.principalType === "organization" ? [input.reference] : [],
  );
  if (input.reference.principalType === "organization")
    return {
      current: directory.current,
      policy: directory.policy,
      dependencies: [],
    };
  const expectedHead = groupHead(directory, input.reference.principalId);
  if (input.reference.version > expectedHead.version)
    throw new PrincipalRecoveryDirectoryAdvanced();
  const adminHead = groupHead(directory, directory.descriptor.adminGroupId);
  const isAdmins = expectedHead.principalId === adminHead.principalId;
  let admins: VerifiedPrincipalPolicyCurrent | null = null;
  if (!isAdmins) {
    admins = (await read.admins(adminHead)).policy;
  }
  const loadExternalAuthority = async (
    citations: readonly ReferencedPrincipalHead[],
  ): Promise<PrincipalPolicyExternalAuthority | undefined> => {
    const references = new Map<string, ReferencedPrincipalHead>();
    for (const citation of citations) {
      if (citation.principalId !== adminHead.principalId)
        throw new KeyingVerificationError(
          "object_mismatch",
          "Group cites another organization's Admins authority",
        );
      if (citation.version > adminHead.version)
        throw new PrincipalRecoveryDirectoryAdvanced();
      references.set(`${citation.version}:${citation.stateHash}`, citation);
    }
    if (!references.size) return undefined;
    const recovered = await read.admins(adminHead, [...references.values()]);
    return {
      currentHead: adminHead,
      states: recovered.policy.retainedHistory.map(({ state, projection }) => ({
        head: authorityHead(state),
        projection,
      })),
    };
  };
  const recovered = await recoverPrincipalPolicyHistory({
    ...input,
    expectedHead,
    retainedReferences: [input.reference],
    historyVerification: isAdmins ? "direct-admins" : "standard",
    ...(isAdmins
      ? {}
      : {
          protection: scopedGroupHistoryProtection(
            input.protection,
            input.organizationId,
            adminHead.principalId,
          ),
        }),
    ...(isAdmins ? {} : { loadExternalAuthority }),
  });
  return {
    ...recovered,
    dependencies: admins ? [directory.policy, admins] : [directory.policy],
  };
}

/** Recover signed directory and strict Admins dependencies without full histories. */
export async function recoverScopedPrincipalPolicyHistoryInBatch(
  options: RecoverScopedPrincipalPolicyHistoryOptions,
  memo?: PrincipalRecoveryMemo,
): Promise<RecoveredScopedPrincipalPolicyHistory> {
  if (options.offline !== undefined && typeof options.offline !== "boolean")
    throw new KeyingVerificationError(
      "invalid_shape",
      "Invalid principal history transport mode",
    );
  if (!options.organizationId)
    throw new KeyingVerificationError(
      "object_mismatch",
      "Principal recovery requires an organization scope",
    );
  const input = {
    apiClient: options.apiClient,
    execSql: options.execSql,
    organizationId: options.organizationId,
    offline: options.offline,
    resolveTrustedUserIdentity: options.resolveTrustedUserIdentity,
    signal: options.signal,
    stillCurrent: options.stillCurrent,
    reference: structuredClone(options.reference),
    protection: ownPrincipalHistoryProtection(options.protection),
  };
  try {
    // Reject malformed exact citations before any discovery or disposable writes.
    createPrincipalPolicyHistoryVerifier({
      principalId: input.reference.principalId,
      principalType: input.reference.principalType,
      retainedReferences: [input.reference],
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const recovered = await recoverScopedPolicy(input, memo);
        assertProjectionVerificationCurrent(
          () => !input.signal?.aborted && input.stillCurrent(),
        );
        return recovered;
      } catch (error) {
        if (!(error instanceof PrincipalRecoveryDirectoryAdvanced)) throw error;
        memo?.directories.clear();
        memo?.admins.clear();
        if (input.offline)
          throw new KeyingVerificationError(
            "missing_dependency",
            "Requested principal evidence is newer than the offline directory",
          );
      }
    }
    throw new PrincipalHistoryRecoveryRaceError(
      "Organization directory remains behind the requested policy evidence",
    );
  } finally {
    input.protection.localKey.fill(0);
  }
}

export function recoverScopedPrincipalPolicyHistory(
  options: RecoverScopedPrincipalPolicyHistoryOptions,
): Promise<RecoveredScopedPrincipalPolicyHistory> {
  return recoverScopedPrincipalPolicyHistoryInBatch(options);
}
