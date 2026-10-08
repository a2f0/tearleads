import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
  verifyPrincipalPolicyHistoryReferences,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { loadPrincipalHistoryReference } from "../../data/persistence/principalHistoryEvidencePersistence";
import {
  type OrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
} from "../../data/principals/organizationAuthorityDescriptor";
import { principalHistoryEvidenceScopeId } from "../../data/principals/principalHistoryPrefixProtection";
import { directoryHistoryProtection } from "../../data/principals/principalHistoryScopeProtection";
import { loadVerifiedPrincipalHistoryPrefix } from "./principalHistoryRecoveryPrefix";
import {
  PrincipalPolicyHistoryReadError,
  type RecoveredPrincipalPolicyHistory,
  type RecoverPrincipalPolicyHistoryOptions,
} from "./principalHistoryRecoveryTypes";
import { reusePrincipalDiscoveryPage } from "./principalRecoveryDiscoveryPage";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

export type PrincipalRecoveryContext = Omit<
  RecoverPrincipalPolicyHistoryOptions,
  | "expectedHead"
  | "retainedReferences"
  | "historyVerification"
  | "loadExternalAuthority"
>;

export interface RecoveredPolicyDirectory
  extends RecoveredPrincipalPolicyHistory {
  readonly descriptor: OrganizationAuthorityDescriptor;
}

export class PrincipalRecoveryDirectoryAdvanced extends Error {}

function exactHead(state: ReferencedPrincipalHead): ReferencedPrincipalHead {
  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    stateHash: state.stateHash,
    keyEpoch: state.keyEpoch,
    keyFingerprint: state.keyFingerprint,
  };
}

/** An unverified discovery read chooses a pin; recovery must authenticate it. */
async function discoverDirectoryHead(input: PrincipalRecoveryContext): Promise<{
  head: ReferencedPrincipalHead;
  genesis: ReferencedPrincipalHead;
  apiClient: PrincipalRecoveryContext["apiClient"];
}> {
  assertProjectionVerificationCurrent(
    () => !input.signal?.aborted && input.stillCurrent(),
  );
  if (input.offline) {
    const principal = {
      principalType: "organization" as const,
      principalId: input.organizationId,
    };
    const scopeId = await principalHistoryEvidenceScopeId({
      organizationId: input.organizationId,
      head: principal,
      protection: input.protection,
    });
    const prefix = await loadVerifiedPrincipalHistoryPrefix(
      input,
      principal,
      scopeId,
    );
    if (!prefix)
      throw new KeyingVerificationError(
        "missing_dependency",
        "Organization directory is unavailable offline",
      );
    const history = prefix.verifier.finish(prefix.head);
    if (!history.ok) throw history.error;
    const genesis = await loadPrincipalHistoryReference({
      execSql: input.execSql,
      scopeId,
      history: history.value,
      version: 1,
    });
    const selected = await verifyPrincipalPolicyHistoryReferences({
      history: history.value,
      references: [genesis],
    });
    if (!selected.ok) throw selected.error;
    return {
      head: prefix.head,
      genesis: genesis.reference,
      apiClient: input.apiClient,
    };
  }
  for await (const result of input.apiClient.getPrincipalPolicyPages(
    "organization",
    input.organizationId,
    { signal: input.signal },
  )) {
    if (!result.ok) throw new PrincipalPolicyHistoryReadError(result);
    assertProjectionVerificationCurrent(
      () => !input.signal?.aborted && input.stillCurrent(),
    );
    const state = result.data.currentState;
    const first = result.data.previousStates[0]?.state ?? state;
    if (
      first.version !== 1 ||
      first.principalType !== "organization" ||
      first.principalId !== input.organizationId
    )
      throw new KeyingVerificationError(
        "missing_dependency",
        "Organization directory discovery requires genesis",
      );
    return {
      apiClient: reusePrincipalDiscoveryPage(input.apiClient, result),
      genesis: {
        principalType: first.principalType,
        principalId: first.principalId,
        version: first.version,
        stateHash: first.stateHash,
        keyEpoch: first.keyEpoch,
        keyFingerprint: first.keyFingerprint,
      },
      head: {
        principalType: "organization",
        principalId: input.organizationId,
        version: state.version,
        stateHash: state.stateHash,
        keyEpoch: state.keyEpoch,
        keyFingerprint: state.keyFingerprint,
      },
    };
  }
  throw new KeyingVerificationError(
    "missing_dependency",
    "Organization directory head is unavailable",
  );
}

export async function recoverPolicyDirectory(
  input: PrincipalRecoveryContext,
  references: readonly ReferencedPrincipalHead[],
  selected?: RecoveredPolicyDirectory,
): Promise<RecoveredPolicyDirectory> {
  const scoped = {
    ...input,
    protection: directoryHistoryProtection(input.protection),
  };
  const {
    head: expectedHead,
    genesis,
    apiClient,
  } = selected
    ? {
        head: exactHead(selected.policy.state),
        genesis: selected.policy.retainedHistory[0]?.state,
        apiClient: input.apiClient,
      }
    : await discoverDirectoryHead(scoped);
  if (genesis?.version !== 1)
    throw new KeyingVerificationError(
      "missing_dependency",
      "Organization directory recovery requires verified genesis",
    );
  if (references.some((reference) => reference.version > expectedHead.version))
    throw new PrincipalRecoveryDirectoryAdvanced();
  const recovered = await recoverPrincipalPolicyHistory({
    ...scoped,
    apiClient,
    expectedHead,
    retainedReferences: references.some((reference) => reference.version === 1)
      ? references
      : [exactHead(genesis), ...references],
  });
  let descriptor: OrganizationAuthorityDescriptor;
  try {
    descriptor = parseOrganizationAuthorityDescriptor(
      recovered.current.currentPayload.ciphertext,
    );
  } catch {
    throw new KeyingVerificationError(
      "invalid_shape",
      "Organization directory payload is invalid",
    );
  }
  if (descriptor.organizationId !== input.organizationId)
    throw new KeyingVerificationError(
      "object_mismatch",
      "Organization directory scope does not match",
    );
  return { ...recovered, descriptor };
}
