import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { rethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import {
  assertProjectionVerificationCurrent,
  isProjectionVerificationCancelledError,
  type ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification/types";
import { errorMessage } from "../../data/shared/errorMessage";
import {
  createRuntimePrincipalPolicyResolver,
  type PrincipalPolicyRecoveryRuntime,
} from "./runtimePolicyRecovery";
import { createRuntimeProjectionPolicyResolver } from "./runtimeProjectionPolicyRecovery";

type PolicyResolver = NonNullable<
  ReferencedPrincipalPolicyWarmer["resolveReference"]
>;
interface PrincipalPolicyWarmRuntime extends PrincipalPolicyRecoveryRuntime {
  readonly util: PrincipalPolicyRecoveryRuntime["util"] & {
    readonly log?: ((message: string) => void) | undefined;
  };
}

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

/**
 * One warmer serves one workflow operation: either the `operation` its root
 * minted, or a fresh one of its own. Its projection collections share one
 * authenticated directory view per operation. Prefetch is best-effort; exact
 * resolution still rejects unavailable evidence.
 */
export function createRuntimePrincipalPolicyWarmer(
  runtime: PrincipalPolicyWarmRuntime,
  options: {
    readonly preferLocalCurrent?: boolean;
    readonly operation?: PrincipalPolicyOperation | undefined;
  } = {},
): ReferencedPrincipalPolicyWarmer {
  const resolve = createRuntimePrincipalPolicyResolver(runtime, options);
  const operation = options.operation ?? createPrincipalPolicyOperation();
  const resolveReference: PolicyResolver = async (input) => {
    if (!resolve)
      throw new ProjectionDependencyUnavailableError(
        "Principal policies require private paged recovery",
      );
    return resolve({
      ...input,
      recoveryBatch: input.recoveryBatch ?? operation,
    });
  };
  return Object.assign(
    (input: Parameters<ReferencedPrincipalPolicyWarmer>[0]) =>
      prefetchReferences(runtime, resolveReference, input),
    {
      resolveReference,
      resolveProjectionHistory: createRuntimeProjectionPolicyResolver(runtime),
    },
  );
}

async function prefetchReferences(
  runtime: PrincipalPolicyWarmRuntime,
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
      runtime.util.log?.(
        `Principal policy prefetch: ${reference.principalId}: ${errorMessage(error)}`,
      );
    }
  }
}
