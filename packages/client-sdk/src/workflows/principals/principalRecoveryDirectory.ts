import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import {
  type OrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
} from "../../data/principals/organizationAuthorityDescriptor";
import {
  PrincipalPolicyHistoryReadError,
  type RecoveredPrincipalPolicyHistory,
  type RecoverPrincipalPolicyHistoryOptions,
} from "./principalHistoryRecoveryTypes";
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

/** An unverified discovery read chooses a pin; recovery must authenticate it. */
async function discoverDirectoryHead(
  input: PrincipalRecoveryContext,
): Promise<ReferencedPrincipalHead> {
  assertProjectionVerificationCurrent(
    () => !input.signal?.aborted && input.stillCurrent(),
  );
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
    return {
      principalType: "organization",
      principalId: input.organizationId,
      version: state.version,
      stateHash: state.stateHash,
      keyEpoch: state.keyEpoch,
      keyFingerprint: state.keyFingerprint,
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
): Promise<RecoveredPolicyDirectory> {
  const expectedHead = await discoverDirectoryHead(input);
  if (references.some((reference) => reference.version > expectedHead.version))
    throw new PrincipalRecoveryDirectoryAdvanced();
  const recovered = await recoverPrincipalPolicyHistory({
    ...input,
    expectedHead,
    retainedReferences: references,
    protection: {
      localKey: input.protection.localKey,
      context: serializeKeyingCanonicalJson([
        "tearleads.sdk.principal-history.directory.v1",
        input.protection.context,
      ]),
    },
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
