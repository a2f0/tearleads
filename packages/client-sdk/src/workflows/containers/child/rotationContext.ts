import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
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
import { signedHistoryEpochIds } from "../../../data/documents/shared/containerKekPathHistory";
import { unwrapContainerKekPath } from "../../../data/documents/shared/projection";
import { projectionVerificationOptions } from "../../../data/documents/shared/types";
import type {
  PrincipalPolicyCache,
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

/**
 * A rotation's target container, with the epoch ids its verified lineage
 * names wherever the projection served it; the re-sealed keyring is anchored
 * to them (#2365 finding 32).
 */
export type SignedRotationTarget = ReturnType<
  typeof getTargetContainerContext
> & { readonly signedEpochIds: ReadonlySet<string> };

/**
 * The projection's target with its signed lineage ids, read from the manifests
 * this rotation's own verification recorded. Every rotation that re-seals a
 * keyring builds its target here, so none can skip the anchor.
 */
export function signedRotationTarget(
  projection: ContainerWriterProjectionResponse,
  verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>,
): SignedRotationTarget {
  const target = getTargetContainerContext(projection);
  return {
    ...target,
    signedEpochIds: signedHistoryEpochIds({
      headManifestHash: target.manifest.manifestHash,
      kek: target.kek,
      verifiedByHash,
    }),
  };
}

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
    /**
     * Keys of epochs the projection names that no wrap on it opens for this
     * signer yet: the ones a batch minted above and has not committed.
     */
    knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
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
  target: SignedRotationTarget;
}> {
  // The target may need repair, but wrapping its successor requires a current parent prefix.
  assertContainerKekPathCurrent(
    input.previousProjection.containerKeks.slice(0, -1),
  );
  const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>();
  const keksByEpochId = await unwrapContainerKekPath({
    execSql: input.execSql,
    knownContainerKeks: input.knownContainerKeks,
    persistVerificationCheckpoints: input.persistVerificationCheckpoints,
    principalPolicyCache: input.principalPolicyCache,
    projection: input.previousProjection,
    secretKey: input.targetSecretKey,
    verifiedByHash,
    ...projectionVerificationOptions(input),
  });
  const target = signedRotationTarget(input.previousProjection, verifiedByHash);
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
