import {
  KeyingVerificationError,
  restorePrincipalPolicyHistoryVerifier,
  type VerifiedPrincipalPolicyCurrent,
  verifyPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyMutationResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import {
  type AcknowledgedPrincipalCurrentPublication,
  type AcknowledgedPrincipalCurrentRetirement,
  persistAcknowledgedPrincipalCurrents,
} from "../../data/persistence/principalCurrentAcknowledgementPersistence";
import { preparePrincipalHistoryEvidencePage } from "../../data/persistence/principalHistoryEvidencePersistence";
import { loadPrincipalHistoryPrefix } from "../../data/persistence/principalHistoryPrefixPersistence";
import {
  principalHistoryEvidenceScopeId,
  principalHistoryPrefixProtection,
} from "../../data/principals/principalHistoryPrefixProtection";
import { ownPrincipalHistoryProtection } from "../../data/principals/principalHistoryProtection";
import { parsePrincipalHistoryStageCurrent } from "../../data/principals/principalHistoryStageProtection";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { collectPrincipalPolicySignerPublicKeys } from "../principals/policyVerification";
import type { RecoverPrincipalPolicyHistoryOptions } from "../principals/principalHistoryRecoveryTypes";
import {
  assertPrincipalHistoryVerificationMode,
  principalHistoryVerificationContext,
} from "../principals/principalHistoryRecoveryVerification";
import { assertAcknowledgedDirectoryBindings } from "./acknowledgedDirectoryBindings";
import { acknowledgeGroupPolicyState } from "./groupPolicyMutationAcknowledgement";
import { groupPolicyMutationHead } from "./groupPolicyMutationHead";
import { prepareInitialGroupCurrentPublication } from "./initialPrincipalCurrentPublication";
import {
  sealPrincipalCurrentPublication,
  sealPrincipalCurrentStage,
} from "./principalCurrentPublicationSeal";
import { assertPrincipalPolicyReceiptArtifacts } from "./principalPolicyReceiptArtifacts";

export type { AcknowledgedPrincipalCurrentRetirement } from "../../data/persistence/principalCurrentAcknowledgementPersistence";

export interface AcknowledgedPrincipalCurrentInput {
  /** Only a newly authored group at version one; never skips a predecessor. */
  readonly initialGroup?: boolean | undefined;
  /** The same scoped protection and verification mode used to recover the predecessor. */
  readonly recovery: Omit<
    RecoverPrincipalPolicyHistoryOptions,
    "execSql" | "organizationId" | "stillCurrent"
  >;
  readonly request: PutPrincipalPolicyRequest;
  readonly response: PrincipalPolicyMutationResponse;
}

async function restorePredecessor(
  options: RecoverPrincipalPolicyHistoryOptions,
) {
  const scopeId = await principalHistoryEvidenceScopeId({
    organizationId: options.organizationId,
    head: options.expectedHead,
    protection: options.protection,
  });
  const saved = await loadPrincipalHistoryPrefix(options.execSql, scopeId);
  if (!saved || saved.organizationId !== options.organizationId)
    throw new KeyingVerificationError(
      "missing_dependency",
      "Acknowledgement requires its authenticated predecessor prefix",
    );
  const restored = await restorePrincipalPolicyHistoryVerifier(
    {
      principalId: options.expectedHead.principalId,
      principalType: options.expectedHead.principalType,
    },
    saved.progress,
    await principalHistoryPrefixProtection(options.protection, saved),
  );
  if (!restored.ok) throw restored.error;
  const history = restored.value.finish(options.expectedHead);
  if (!history.ok) throw history.error;
  const artifacts = parsePrincipalHistoryStageCurrent({
    currentJson: saved.currentJson,
    afterVersion: saved.version - 1,
  });
  if (!artifacts)
    throw new KeyingVerificationError(
      "invalid_shape",
      "Acknowledged predecessor artifacts are malformed",
    );
  const previous = await verifyPrincipalPolicyCurrent({
    current: artifacts,
    history: history.value,
  });
  if (!previous.ok) throw previous.error;
  return {
    scopeId,
    saved,
    artifacts,
    verifier: restored.value,
    previous: previous.value,
  };
}

async function preparePublication(
  options: RecoverPrincipalPolicyHistoryOptions,
  request: PutPrincipalPolicyRequest,
  response: PrincipalPolicyMutationResponse,
): Promise<AcknowledgedPrincipalCurrentPublication> {
  options = {
    ...options,
    protection: {
      ...options.protection,
      context: principalHistoryVerificationContext(options),
    },
  };
  const current = () => !options.signal?.aborted && options.stillCurrent();
  assertProjectionVerificationCurrent(current);
  const { scopeId, saved, artifacts, verifier, previous } =
    await restorePredecessor(options);
  const expectedHead = await groupPolicyMutationHead(request);
  assertPrincipalPolicyReceiptArtifacts({ expectedHead, request, response });
  const keys = await collectPrincipalPolicySignerPublicKeys({
    bundle: { currentState: response.currentState, previousStates: [] },
    resolveTrustedUserIdentity: options.resolveTrustedUserIdentity,
  });
  assertProjectionVerificationCurrent(current);
  if ("error" in keys)
    throw new KeyingVerificationError(
      keys.error === "not-found" ? "missing_dependency" : "signer_mismatch",
      "Acknowledged principal signer could not be authenticated",
    );
  const externalAuthority = await options.loadExternalAuthority?.(
    request.state.externalAuthority ? [request.state.externalAuthority] : [],
  );
  assertProjectionVerificationCurrent(current);
  const policy = await acknowledgeGroupPolicyState({
    verifiedCurrentPolicy: previous,
    expectedHead,
    request,
    response: response.currentState,
    signerPublicKeys: keys.signerPublicKeys,
    externalAuthority,
    stillCurrent: current,
  });
  const entry = {
    state: response.currentState,
    projection: response.currentProjection,
    grants: response.currentGrants,
  };
  assertPrincipalHistoryVerificationMode(options, [entry]);
  const predecessorStage = await sealPrincipalCurrentStage(
    options,
    previous.state,
    verifier,
    artifacts,
  );
  const appended = await verifier.append({
    entries: [entry],
    signerPublicKeys: keys.signerPublicKeys,
    ...(externalAuthority ? { externalAuthority } : {}),
  });
  if (!appended.ok) throw appended.error;
  const sealed = await sealPrincipalCurrentPublication(
    options,
    scopeId,
    expectedHead,
    verifier,
    response,
  );
  assertProjectionVerificationCurrent(current);
  return {
    policy,
    previousPrefixProgress: saved.progress,
    predecessorStage,
    ...sealed,
    evidence: await preparePrincipalHistoryEvidencePage({
      scopeId,
      organizationId: options.organizationId,
      entries: [entry],
      nodes: appended.value.indexNodes,
    }),
  };
}

/** Extend authenticated local progress and retain exact acknowledged artifacts atomically with pins. */
export async function retainAcknowledgedPrincipalCurrents(input: {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly entries: readonly AcknowledgedPrincipalCurrentInput[];
  readonly retirements?:
    | readonly AcknowledgedPrincipalCurrentRetirement[]
    | undefined;
  readonly stillCurrent: () => boolean;
}): Promise<VerifiedPrincipalPolicyCurrent[]> {
  const execSql = input.execSql;
  const organizationId = input.organizationId;
  const stillCurrent = input.stillCurrent;
  const retirements = structuredClone(input.retirements ?? []);
  const entries: {
    initialGroup: boolean;
    request: PutPrincipalPolicyRequest;
    response: PrincipalPolicyMutationResponse;
    options: RecoverPrincipalPolicyHistoryOptions;
  }[] = [];
  try {
    assertProjectionVerificationCurrent(stillCurrent);
    for (const entry of input.entries)
      entries.push({
        initialGroup: entry.initialGroup === true,
        request: structuredClone(entry.request),
        response: structuredClone(entry.response),
        options: {
          ...entry.recovery,
          expectedHead: structuredClone(entry.recovery.expectedHead),
          protection: ownPrincipalHistoryProtection(entry.recovery.protection),
          execSql,
          organizationId,
          stillCurrent,
        },
      });
    const publications: AcknowledgedPrincipalCurrentPublication[] = [];
    for (const entry of entries)
      publications.push(
        await (entry.initialGroup
          ? prepareInitialGroupCurrentPublication
          : preparePublication)(entry.options, entry.request, entry.response),
      );
    assertAcknowledgedDirectoryBindings(
      organizationId,
      entries.map(({ response }) => response),
    );
    await persistAcknowledgedPrincipalCurrents({
      execSql,
      organizationId,
      entries: publications,
      retirements,
      stillCurrent: () =>
        stillCurrent() &&
        entries.every((entry) => !entry.options.signal?.aborted),
    });
    return publications.map(({ policy }) => policy);
  } finally {
    for (const entry of entries) entry.options.protection.localKey.fill(0);
  }
}
