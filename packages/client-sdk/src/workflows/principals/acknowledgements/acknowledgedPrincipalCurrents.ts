import {
  KeyingVerificationError,
  type VerifiedPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyMutationResponse } from "@tearleads/validators/response";
import { assertProjectionVerificationCurrent } from "../../../data/keyingProjectionVerification/types";
import {
  type AcknowledgedPrincipalCurrentPublication,
  type AcknowledgedPrincipalCurrentRetirement,
  PrincipalAcknowledgementChangedError,
  persistAcknowledgedPrincipalCurrents,
} from "../../../data/persistence/principalCurrentAcknowledgementPersistence";
import { preparePrincipalHistoryEvidencePage } from "../../../data/persistence/principalHistory/principalHistoryEvidencePersistence";
import { ownPrincipalHistoryProtection } from "../../../data/principals/principalHistoryProtection";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { RecoverPrincipalPolicyHistoryOptions } from "../historyRecovery/principalHistoryRecoveryTypes";
import {
  assertPrincipalHistoryVerificationMode,
  principalHistoryVerificationContext,
} from "../historyRecovery/principalHistoryRecoveryVerification";
import { collectPrincipalPolicySignerPublicKeys } from "../policyVerification";
import {
  type AcknowledgedPrincipalPredecessor,
  restoreAcknowledgedPrincipalPredecessor,
} from "./acknowledgedPrincipalPredecessor";
import { prepareInitialGroupCurrentPublication } from "./initialPrincipalCurrentPublication";
import type { PrincipalAcknowledgementChecks } from "./principalAcknowledgementChecks";
import {
  sealPrincipalCurrentPublication,
  sealPrincipalCurrentStage,
} from "./principalCurrentPublicationSeal";
import { reconcileAcknowledgedPrincipalCurrent } from "./reconcileAcknowledgedPrincipalCurrent";

export interface AcknowledgedPrincipalCurrentInput {
  /** Capture before submitting the mutation; null only for a new group. */
  readonly predecessor: AcknowledgedPrincipalPredecessor | null;
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

async function preparePublication(
  options: RecoverPrincipalPolicyHistoryOptions,
  request: PutPrincipalPolicyRequest,
  response: PrincipalPolicyMutationResponse,
  predecessor: AcknowledgedPrincipalPredecessor | null,
  checks: PrincipalAcknowledgementChecks,
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
  const {
    scopeId,
    saved,
    artifacts,
    verifier,
    previous,
    predecessorIndexRootHash,
  } = await restoreAcknowledgedPrincipalPredecessor(options, predecessor);
  const expectedHead = await checks.authoredHead(request);
  await checks.assertReceipt({ expectedHead, request, response });
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
  const policy = await checks.acknowledgeSuccessor({
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
    predecessorIndexRootHash,
    ...sealed,
    evidence: await preparePrincipalHistoryEvidencePage({
      indexRootHash: appended.value.indexRootHash,
      scopeId,
      organizationId: options.organizationId,
      entries: [entry],
      nodes: appended.value.indexNodes,
    }),
  };
}

/** The acknowledged currents of one mutation, recorded together. */
export interface AcknowledgedPrincipalCurrentBatch {
  readonly execSql: ExecSql;
  readonly organizationId: string;
  readonly entries: readonly AcknowledgedPrincipalCurrentInput[];
  readonly retirements?:
    | readonly AcknowledgedPrincipalCurrentRetirement[]
    | undefined;
  readonly stillCurrent: () => boolean;
}

/**
 * Extend authenticated local progress and retain exact acknowledged artifacts
 * atomically with pins, once `checks` accept each acknowledgement.
 */
export async function recordAcknowledgedPrincipalCurrents(
  input: AcknowledgedPrincipalCurrentBatch & {
    readonly checks: PrincipalAcknowledgementChecks;
  },
): Promise<VerifiedPrincipalPolicyCurrent[]> {
  const checks = input.checks;
  const execSql = input.execSql;
  const organizationId = input.organizationId;
  const stillCurrent = input.stillCurrent;
  const retirements = structuredClone(input.retirements ?? []);
  const entries: {
    initialGroup: boolean;
    request: PutPrincipalPolicyRequest;
    response: PrincipalPolicyMutationResponse;
    options: RecoverPrincipalPolicyHistoryOptions;
    predecessor: AcknowledgedPrincipalPredecessor | null;
  }[] = [];
  try {
    assertProjectionVerificationCurrent(stillCurrent);
    for (const entry of input.entries)
      entries.push({
        initialGroup: entry.initialGroup === true,
        predecessor: structuredClone(entry.predecessor),
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
          : preparePublication)(
          entry.options,
          entry.request,
          entry.response,
          entry.predecessor,
          checks,
        ),
      );
    checks.assertDirectoryBindings(
      organizationId,
      entries.map(({ response }) => response),
    );
    for (let attempt = 0; ; attempt += 1) {
      const reconciled = [];
      for (const [index, publication] of publications.entries()) {
        const entry = entries[index];
        if (!entry) throw new Error("Missing acknowledgement entry");
        reconciled.push(
          await reconcileAcknowledgedPrincipalCurrent(
            entry.options,
            publication,
          ),
        );
      }
      try {
        await persistAcknowledgedPrincipalCurrents({
          execSql,
          organizationId,
          entries: reconciled,
          retirements,
          stillCurrent: () =>
            stillCurrent() &&
            entries.every((entry) => !entry.options.signal?.aborted),
        });
        break;
      } catch (error) {
        if (
          !(error instanceof PrincipalAcknowledgementChangedError) ||
          attempt >= 7
        )
          throw error;
      }
    }
    return publications.map(({ policy }) => policy);
  } finally {
    for (const entry of entries) entry.options.protection.localKey.fill(0);
  }
}
