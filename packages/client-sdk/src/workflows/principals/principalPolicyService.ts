import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
import type { PrincipalPolicyHistoryProgressOptions } from "@tearleads/crypto";
import { rethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import {
  assertProjectionVerificationCurrent,
  isProjectionVerificationCancelledError,
  type ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification/types";
import { directoryHistoryProtection } from "../../data/principals/principalHistoryScopeProtection";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import { ProjectionDependencyUnavailableError } from "../../data/shared/dependencyUnavailable";
import { errorMessage } from "../../data/shared/errorMessage";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { AcknowledgedPrincipalCurrentInput } from "./acknowledgements/acknowledgedPrincipalCurrents";
import {
  apiPrincipalPolicyPageReader,
  type PrincipalPolicyPageReader,
} from "./principalPolicyHistoryReader";
import {
  createPrincipalPolicyCurrentResolver,
  type PrincipalPolicyCollaborators,
  type PrincipalPolicyCurrentResolver,
} from "./runtimePolicyRecovery";
import { createProjectionPolicyHistoryResolver } from "./runtimeProjectionPolicyRecovery";

type PolicyResolver = NonNullable<
  ReferencedPrincipalPolicyWarmer["resolveReference"]
>;

/**
 * The token of one reconciliation pass or user workflow. Every warmer created
 * with it shares one authenticated directory view, discovered once; the view
 * dies with the token, an organization hint, a durable pin past it, or the end
 * of its producing lease. Mint one at the pass or workflow root.
 */
export type PrincipalPolicyOperation = object;

export function createPrincipalPolicyOperation(): PrincipalPolicyOperation {
  return {};
}

export interface PrincipalPolicyWarmerOptions {
  readonly preferLocalCurrent?: boolean;
  readonly operation?: PrincipalPolicyOperation | undefined;
}

/** A runtime snapshot carrying the policy service its producer bound, and its executor. */
export interface PrincipalPolicyRuntime {
  readonly infra: { readonly execSql: ExecSql };
  readonly principalPolicies: PrincipalPolicyService;
}

let collaboratorsOf: (
  service: PrincipalPolicyService,
) => PrincipalPolicyCollaborators;

/**
 * Principal Policy: recovers, verifies, and prefetches the principal policy
 * evidence that projections cite. One instance binds one runtime snapshot's
 * API client, executor, online state, reporter, logger, trusted-identity
 * resolver, and the history-protection lease that snapshot bound; every view
 * derived from the snapshot shares it. The collaborators sit in a private
 * field, so a public runtime view carrying the service exposes no custody.
 */
export class PrincipalPolicyService {
  readonly #policies: PrincipalPolicyCollaborators;

  static {
    collaboratorsOf = (service) => service.#policies;
  }

  constructor(collaborators: PrincipalPolicyCollaborators) {
    this.#policies = collaborators;
  }

  /** Undefined without history custody or a paged history reader. */
  createCurrentPolicyResolver(): PrincipalPolicyCurrentResolver | undefined {
    return createPrincipalPolicyCurrentResolver(this.#policies);
  }

  /** Undefined without history custody or a projection history reader. */
  createProjectionHistoryResolver(): ReferencedPrincipalPolicyWarmer["resolveProjectionHistory"] {
    return createProjectionPolicyHistoryResolver(this.#policies);
  }

  /**
   * One warmer serves one workflow operation: either the `operation` its root
   * minted, or a fresh one of its own. Its projection collections share one
   * authenticated directory view per operation. Prefetch is best-effort; exact
   * resolution still rejects unavailable evidence.
   */
  createWarmer(
    options: PrincipalPolicyWarmerOptions = {},
  ): ReferencedPrincipalPolicyWarmer {
    const resolve = this.createCurrentPolicyResolver();
    const operation = options.operation ?? createPrincipalPolicyOperation();
    const resolveReference: PolicyResolver = async (input) => {
      if (!resolve)
        throw new ProjectionDependencyUnavailableError(
          "Principal policies require private paged recovery",
        );
      return resolve({
        ...input,
        recoveryBatch: input.recoveryBatch ?? operation,
        preferLocalCurrent: options.preferLocalCurrent,
      });
    };
    const policies = this.#policies;
    return Object.assign(
      (input: Parameters<ReferencedPrincipalPolicyWarmer>[0]) =>
        prefetchReferences(policies, resolveReference, input),
      {
        resolveReference,
        resolveProjectionHistory: this.createProjectionHistoryResolver(),
      },
    );
  }
}

async function prefetchReferences(
  policies: PrincipalPolicyCollaborators,
  resolve: PolicyResolver,
  input: Parameters<ReferencedPrincipalPolicyWarmer>[0],
): Promise<void> {
  for (const reference of input.references) {
    try {
      assertProjectionVerificationCurrent(input.stillCurrent);
      const resolved = await resolve({ ...input, reference });
      assertProjectionVerificationCurrent(resolved.stillCurrent);
    } catch (error) {
      if (isProjectionVerificationCancelledError(error)) return;
      // Recovery already reports signature/authority failures. Keep them fatal.
      rethrowKeyingVerificationError(error);
      policies.util.log?.(
        `Principal policy prefetch: ${reference.principalId}: ${errorMessage(error)}`,
      );
    }
  }
}

export interface CurrentPrincipalMutationLeaseContext {
  readonly protection: PrincipalPolicyHistoryProgressOptions;
  readonly stillCurrent: () => boolean;
  readonly resolveCurrentPolicy: PrincipalPolicyCurrentResolver;
  readonly historyReader: PrincipalPolicyPageReader;
  readonly directoryRecovery: (
    current: PrincipalPolicyPageCurrent,
  ) => AcknowledgedPrincipalCurrentInput["recovery"];
}

export type CurrentPrincipalMutationLease = <T>(
  callerCurrent: () => boolean,
  work: (context: CurrentPrincipalMutationLeaseContext) => Promise<T>,
) => Promise<T>;

/**
 * One lifetime fence and private custody boundary for every current-policy
 * mutation. It hands the snapshot's private history protection to `work`, so
 * it stays off the class and out of the package root: a public runtime view
 * carrying the service cannot reach it.
 */
export function createCurrentPrincipalMutationLease(
  service: PrincipalPolicyService,
): CurrentPrincipalMutationLease | undefined {
  const policies = collaboratorsOf(service);
  const lease = policies.withPrincipalHistoryProtection;
  const resolveCurrentPolicy = createPrincipalPolicyCurrentResolver(policies);
  const historyReader = apiPrincipalPolicyPageReader(policies.apiClient);
  if (!lease || !resolveCurrentPolicy || !historyReader) return undefined;
  return async <T>(
    callerCurrent: () => boolean,
    work: (context: CurrentPrincipalMutationLeaseContext) => Promise<T>,
  ): Promise<T> =>
    lease(async ({ protection, stillCurrent: leaseCurrent }) => {
      let active = true;
      const stillCurrent = () => active && leaseCurrent() && callerCurrent();
      try {
        assertProjectionVerificationCurrent(stillCurrent);
        const result = await work({
          protection,
          stillCurrent,
          resolveCurrentPolicy,
          historyReader,
          directoryRecovery: (current) => ({
            historyReader,
            expectedHead: principalPolicyReferenceFromBundle(current),
            protection: directoryHistoryProtection(protection),
            resolveTrustedUserIdentity: policies.resolveTrustedUserIdentity,
          }),
        });
        assertProjectionVerificationCurrent(stillCurrent);
        return result;
      } finally {
        active = false;
      }
    });
}
