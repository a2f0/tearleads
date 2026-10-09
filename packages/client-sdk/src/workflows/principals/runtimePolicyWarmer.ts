import { errorMessage } from "../../data/errorMessage";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { rethrowKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import {
  assertProjectionVerificationCurrent,
  isProjectionVerificationCancelledError,
  type ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification/types";
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

/** Prefetch is best-effort; exact resolution still rejects unavailable evidence. */
export function createRuntimePrincipalPolicyWarmer(
  runtime: PrincipalPolicyWarmRuntime,
  options: { readonly preferLocalCurrent?: boolean } = {},
): ReferencedPrincipalPolicyWarmer {
  const resolve = createRuntimePrincipalPolicyResolver(runtime, options);
  const resolveReference: PolicyResolver = async (input) => {
    if (!resolve)
      throw new ProjectionDependencyUnavailableError(
        "Principal policies require private paged recovery",
      );
    return resolve(input);
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
  const recoveryBatch = {};
  for (const reference of input.references) {
    try {
      assertProjectionVerificationCurrent(input.stillCurrent);
      const resolved = await resolve({ ...input, reference, recoveryBatch });
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
