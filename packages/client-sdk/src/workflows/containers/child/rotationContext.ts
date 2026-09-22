import type {
  ContainerKekResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  getParentKekForTarget,
  getParentWrappingPublicKey,
  getTargetContainerContext,
  readContainerState,
} from "../../../data/containers/shared/projection";
import type { ContainerMutationAuthor } from "../../../data/containers/shared/types";
import { assertContainerKekPathCurrent } from "../../../data/documents/shared/containerKekCurrency";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import { projectionVerificationOptions } from "../../../data/documents/shared/types";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

export function requireUnwrappedKek(
  keksByEpochId: ReadonlyMap<string, Uint8Array>,
  kek: Pick<ContainerKekResponse, "containerKeyEpochId">,
  label: string,
): Uint8Array {
  const keyMaterial = keksByEpochId.get(kek.containerKeyEpochId);
  if (!keyMaterial) {
    throw new Error(`${label} KEK could not be unwrapped`);
  }
  return keyMaterial;
}

/**
 * The shared rotation prologue for rekey and revoke: unwrap the projection's
 * KEK path, require the predecessor key, check the author's organization, and
 * surface the authenticated parent public key when one exists.
 */
export async function resolveRotationContext(
  input: {
    author: ContainerMutationAuthor;
    execSql: ExecSql;
    persistVerificationCheckpoints?: boolean | undefined;
    previousProjection: ContainerWriterProjectionResponse;
    /** Verified policies the path may cite before they are stored locally. */
    principalPolicyCache?: PrincipalPolicyCache | undefined;
    resolveProjectionUserKey: ProjectionUserKeyResolver;
    stillCurrent?: (() => boolean) | undefined;
    targetSecretKey: Uint8Array;
    warmReferencedPrincipalPolicies?:
      | ReferencedPrincipalPolicyWarmer
      | undefined;
  },
  operationLabel: string,
): Promise<{
  parentKek: ReturnType<typeof getParentKekForTarget>;
  parentPublicKey: string | null;
  predecessorContainerKey: Uint8Array;
  previousState: ReturnType<typeof readContainerState>;
  target: ReturnType<typeof getTargetContainerContext>;
}> {
  // The target may need repair, but wrapping its successor requires a current parent prefix.
  assertContainerKekPathCurrent(
    input.previousProjection.containerKeks.slice(0, -1),
  );
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    persistVerificationCheckpoints: input.persistVerificationCheckpoints,
    principalPolicyCache: input.principalPolicyCache,
    projection: input.previousProjection,
    secretKey: input.targetSecretKey,
    ...projectionVerificationOptions(input),
  });
  const target = getTargetContainerContext(input.previousProjection);
  const predecessorContainerKey = requireUnwrappedKek(
    keksByEpochId,
    target.kek,
    `Container ${operationLabel} predecessor`,
  );
  const previousState = readContainerState(target.manifest);
  if (previousState.organizationId !== input.author.organizationId) {
    throw new Error(`Container ${operationLabel} author organization mismatch`);
  }

  const parentKek = getParentKekForTarget(input.previousProjection);
  const parentPublicKey = getParentWrappingPublicKey(input.previousProjection);
  return {
    parentKek,
    parentPublicKey,
    predecessorContainerKey,
    previousState,
    target,
  };
}
