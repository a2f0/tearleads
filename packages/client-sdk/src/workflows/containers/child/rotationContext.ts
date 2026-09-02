import type {
  ContainerKekResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  getParentKekForTarget,
  getTargetContainerContext,
  readContainerState,
} from "../../../data/containers/shared/projection";
import type { ContainerMutationAuthor } from "../../../data/containers/shared/types";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import { projectionVerificationOptions } from "../../../data/documents/shared/types";
import type {
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
 * surface the parent KEK material when one exists.
 */
export async function resolveRotationContext(
  input: {
    author: ContainerMutationAuthor;
    execSql: ExecSql;
    persistVerificationCheckpoints?: boolean | undefined;
    previousProjection: ContainerWriterProjectionResponse;
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
  parentKekMaterial: Uint8Array | null;
  predecessorContainerKey: Uint8Array;
  previousState: ReturnType<typeof readContainerState>;
  target: ReturnType<typeof getTargetContainerContext>;
}> {
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    persistVerificationCheckpoints: input.persistVerificationCheckpoints,
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
  const parentKekMaterial = parentKek
    ? (keksByEpochId.get(parentKek.containerKeyEpochId) ?? null)
    : null;
  return {
    parentKek,
    parentKekMaterial,
    predecessorContainerKey,
    previousState,
    target,
  };
}
