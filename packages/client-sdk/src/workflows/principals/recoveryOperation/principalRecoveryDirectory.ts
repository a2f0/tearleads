import type { RequestSuccess } from "@tearleads/api-client";
import {
  KeyingVerificationError,
  type ReferencedPrincipalHead,
  verifyPrincipalPolicyHistoryReferences,
} from "@tearleads/crypto";
import {
  isPrincipalPolicyPageResponse,
  isPrincipalPolicyUnchangedResponse,
  type PrincipalPolicyPageResponse,
} from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import { loadPrincipalHistoryReference } from "../../../data/persistence/principalHistory/principalHistoryEvidencePersistence";
import {
  type OrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
} from "../../../data/principals/organizationAuthorityDescriptor";
import { principalHistoryEvidenceScopeId } from "../../../data/principals/principalHistoryPrefixProtection";
import { directoryHistoryProtection } from "../../../data/principals/principalHistoryScopeProtection";
import { loadVerifiedPrincipalHistoryPrefix } from "../historyRecovery/principalHistoryRecoveryPrefix";
import {
  PrincipalPolicyHistoryReadError,
  type RecoveredPrincipalPolicyHistory,
  type RecoverPrincipalPolicyHistoryOptions,
} from "../historyRecovery/principalHistoryRecoveryTypes";
import { recoverPrincipalPolicyHistory } from "../historyRecovery/recoverPrincipalPolicyHistory";
import { reusePrincipalDiscoveryPage } from "./principalRecoveryDiscoveryPage";

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

interface DiscoveredDirectoryHead {
  readonly head: ReferencedPrincipalHead;
  readonly genesis: ReferencedPrincipalHead;
  readonly historyReader: PrincipalRecoveryContext["historyReader"];
}

function assertDiscoveryCurrent(input: PrincipalRecoveryContext): void {
  assertProjectionVerificationCurrent(
    () => !input.signal?.aborted && input.stillCurrent(),
  );
}

/**
 * The directory head and genesis this device has completely authenticated,
 * from its protected verified prefix, or null when it holds none.
 */
async function loadHeldDirectoryHead(
  input: PrincipalRecoveryContext,
): Promise<Omit<DiscoveredDirectoryHead, "historyReader"> | null> {
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
  if (!prefix) return null;
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
  return { head: exactHead(prefix.head), genesis: genesis.reference };
}

/** Disposable local evidence never refuses an online discovery; it reads fully. */
async function loadHeldDirectoryHeadOnline(input: PrincipalRecoveryContext) {
  try {
    return await loadHeldDirectoryHead(input);
  } catch {
    assertDiscoveryCurrent(input);
    return null;
  }
}

function discoveredPage(
  input: PrincipalRecoveryContext,
  result: RequestSuccess<PrincipalPolicyPageResponse>,
): DiscoveredDirectoryHead {
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
    historyReader: reusePrincipalDiscoveryPage(input.historyReader, result),
    genesis: exactHead(first),
    // The requested identity, never the page's: discovery picks only a pin.
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

/**
 * Ask whether the held head is still live. An `unchanged` reply naming exactly
 * that head reuses it; recovery then authenticates the held artifacts again
 * and reloads the checkpoint. Any other reply that is not a page leaves the
 * caller to read the first page unconditionally.
 */
async function discoverConditionally(
  input: PrincipalRecoveryContext,
  discover: NonNullable<
    PrincipalRecoveryContext["historyReader"]["getPrincipalPolicyDiscovery"]
  >,
): Promise<DiscoveredDirectoryHead | null> {
  const held = await loadHeldDirectoryHeadOnline(input);
  assertDiscoveryCurrent(input);
  const result = await discover("organization", input.organizationId, {
    signal: input.signal,
    ifHead: held?.head,
  });
  if (!result.ok) throw new PrincipalPolicyHistoryReadError(result);
  assertDiscoveryCurrent(input);
  const reply = result.data;
  if (isPrincipalPolicyUnchangedResponse(reply))
    return held && principalHeadMatchesReference(reply.head, held.head)
      ? { ...held, historyReader: input.historyReader }
      : null;
  // Anything but the strict bare head must be a page; otherwise read again.
  return isPrincipalPolicyPageResponse(reply)
    ? discoveredPage(input, { ok: true, data: reply })
    : null;
}

/** An unverified discovery read chooses a pin; recovery must authenticate it. */
async function discoverDirectoryHead(
  input: PrincipalRecoveryContext,
): Promise<DiscoveredDirectoryHead> {
  assertDiscoveryCurrent(input);
  if (input.offline) {
    const held = await loadHeldDirectoryHead(input);
    if (!held)
      throw new KeyingVerificationError(
        "missing_dependency",
        "Organization directory is unavailable offline",
      );
    return { ...held, historyReader: input.historyReader };
  }
  const discover = input.historyReader.getPrincipalPolicyDiscovery;
  const conditional = discover
    ? await discoverConditionally(input, discover)
    : null;
  if (conditional) return conditional;
  for await (const result of input.historyReader.getPrincipalPolicyPages(
    "organization",
    input.organizationId,
    { signal: input.signal },
  )) {
    if (!result.ok) throw new PrincipalPolicyHistoryReadError(result);
    assertDiscoveryCurrent(input);
    return discoveredPage(input, result);
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
    historyReader,
  } = selected
    ? {
        head: exactHead(selected.policy.state),
        genesis: selected.policy.retainedHistory[0]?.state,
        historyReader: input.historyReader,
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
    historyReader,
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
