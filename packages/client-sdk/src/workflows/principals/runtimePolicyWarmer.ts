import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import {
  assertProjectionVerificationCurrent,
  type ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification/types";
import {
  createRuntimePrincipalPolicyResolver,
  type PrincipalPolicyRecoveryRuntime,
} from "./runtimePolicyRecovery";
import { createRuntimeProjectionPolicyResolver } from "./runtimeProjectionPolicyRecovery";

/** Warm exact references through durable paged recovery within the caller's lifetime. */
export function createRuntimePrincipalPolicyWarmer(
  runtime: PrincipalPolicyRecoveryRuntime,
  options: { readonly preferLocalCurrent?: boolean } = {},
): ReferencedPrincipalPolicyWarmer {
  const resolve = createRuntimePrincipalPolicyResolver(runtime, options);
  const resolveReference: NonNullable<
    ReferencedPrincipalPolicyWarmer["resolveReference"]
  > = (input) => {
    if (!resolve)
      throw new ProjectionDependencyUnavailableError(
        "Principal policies require private paged recovery",
      );
    return resolve(input);
  };
  const warmer = async (
    input: Parameters<ReferencedPrincipalPolicyWarmer>[0],
  ) => {
    const recoveryBatch = {};
    for (const reference of input.references) {
      assertProjectionVerificationCurrent(input.stillCurrent);
      const resolved = await resolveReference({
        ...input,
        reference,
        recoveryBatch,
      });
      assertProjectionVerificationCurrent(resolved.stillCurrent);
    }
    assertProjectionVerificationCurrent(input.stillCurrent);
  };
  return Object.assign(warmer, {
    resolveReference,
    resolveProjectionHistory: createRuntimeProjectionPolicyResolver(runtime),
  });
}
