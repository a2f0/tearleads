import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
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
  current: PrincipalPolicyPageCurrent,
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
  const stillCurrent = () => !options.signal?.aborted && options.stillCurrent();
  assertProjectionVerificationCurrent(stillCurrent);
  const {
    scopeId,
    saved,
    artifacts,
    verifier,
    previous,
    predecessorIndexRootHash,
  } = await restoreAcknowledgedPrincipalPredecessor(options, predecessor);
  const expectedHead = await checks.authoredHead(request);
  const keys = await collectPrincipalPolicySignerPublicKeys({
    bundle: { currentState: current.currentState, previousStates: [] },
    resolveTrustedUserIdentity: options.resolveTrustedUserIdentity,
  });
  assertProjectionVerificationCurrent(stillCurrent);
  if ("error" in keys)
    throw new KeyingVerificationError(
      keys.error === "not-found" ? "missing_dependency" : "signer_mismatch",
      "Acknowledged principal signer could not be authenticated",
    );
  const externalAuthority = await options.loadExternalAuthority?.(
    request.state.externalAuthority ? [request.state.externalAuthority] : [],
  );
  assertProjectionVerificationCurrent(stillCurrent);
  const policy = await checks.acknowledgeSuccessor({
    verifiedCurrentPolicy: previous,
    expectedHead,
    request,
    response: current.currentState,
    signerPublicKeys: keys.signerPublicKeys,
    externalAuthority,
    stillCurrent,
  });
  const entry = {
    state: current.currentState,
    projection: current.currentProjection,
    grants: current.currentGrants,
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
    current,
  );
  assertProjectionVerificationCurrent(stillCurrent);
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

async function reconcilePublications(
  entries: readonly {
    readonly options: RecoverPrincipalPolicyHistoryOptions;
  }[],
  publications: readonly AcknowledgedPrincipalCurrentPublication[],
) {
  const reconciled = [];
  for (const [index, publication] of publications.entries()) {
    const entry = entries[index];
    if (!entry) throw new Error("Missing acknowledgement entry");
    reconciled.push(
      await reconcileAcknowledgedPrincipalCurrent(entry.options, publication),
    );
  }
  return reconciled;
}

interface OwnedAcknowledgementEntry {
  readonly initialGroup: boolean;
  readonly request: PutPrincipalPolicyRequest;
  readonly response: PrincipalPolicyMutationResponse;
  readonly options: RecoverPrincipalPolicyHistoryOptions;
  readonly predecessor: AcknowledgedPrincipalPredecessor | null;
}

/** Rebuild each acknowledged current from its owned request, then prepare it. */
async function preparePublications(
  entries: readonly OwnedAcknowledgementEntry[],
  checks: PrincipalAcknowledgementChecks,
) {
  const currents: PrincipalPolicyPageCurrent[] = [];
  for (const entry of entries)
    currents.push(
      await checks.acknowledgedCurrent({
        request: entry.request,
        response: entry.response,
      }),
    );
  const publications: AcknowledgedPrincipalCurrentPublication[] = [];
  for (const [index, entry] of entries.entries()) {
    const current = currents[index];
    if (!current) throw new Error("Missing acknowledgement entry");
    publications.push(
      await (entry.initialGroup
        ? prepareInitialGroupCurrentPublication
        : preparePublication)(
        entry.options,
        entry.request,
        current,
        entry.predecessor,
        checks,
      ),
    );
  }
  return { currents, publications };
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
  const entries: OwnedAcknowledgementEntry[] = [];
  try {
    assertProjectionVerificationCurrent(stillCurrent);
    // Own every entry and protection key before the first await, so a caller
    // mutating a later receipt cannot change what this batch checks.
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
    const { currents, publications } = await preparePublications(
      entries,
      checks,
    );
    checks.assertDirectoryBindings(organizationId, currents);
    for (let attempt = 0; ; attempt += 1) {
      const reconciled = await reconcilePublications(entries, publications);
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
