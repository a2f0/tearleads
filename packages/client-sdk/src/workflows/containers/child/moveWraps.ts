import type {
  ContainerAccessManifestState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  ContainerKekResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { uniquePrincipalPolicies } from "../../../data/containers/shared/principalPolicies";
import { readContainerState } from "../../../data/containers/shared/projection";
import { assertContainerKekPathCurrent } from "../../../data/documents/shared/containerKekCurrency";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildContainerRotationWraps } from "./rotationWraps";

export async function collectContainerMovePrincipalPolicies(input: {
  destinationParentProjection: ContainerWriterProjectionResponse;
  execSql: ExecSql;
  previousProjection: ContainerWriterProjectionResponse;
  resolveUserKey: ProjectionUserKeyResolver;
  stillCurrent?: (() => boolean) | undefined;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<VerifiedPrincipalPolicy[]> {
  const [sourcePolicies, destinationParentPolicies] = await Promise.all([
    collectContainerWriterProjectionPrincipalPolicies({
      execSql: input.execSql,
      projection: input.previousProjection,
      resolveUserKey: input.resolveUserKey,
      stillCurrent: input.stillCurrent,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    }),
    collectContainerWriterProjectionPrincipalPolicies({
      execSql: input.execSql,
      projection: input.destinationParentProjection,
      resolveUserKey: input.resolveUserKey,
      stillCurrent: input.stillCurrent,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    }),
  ]);
  return uniquePrincipalPolicies([
    ...sourcePolicies,
    ...destinationParentPolicies,
  ]);
}

export async function buildContainerMoveWraps(input: {
  principalPolicies: readonly VerifiedPrincipalPolicy[];
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  destinationParentKek: ContainerKekResponse;
  destinationParentProjection: ContainerWriterProjectionResponse;
  execSql: ExecSql;
  manifestHash: string;
  previousProjection: ContainerWriterProjectionResponse;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  state: ContainerAccessManifestState;
  stillCurrent?: (() => boolean) | undefined;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}) {
  assertContainerKekPathCurrent(
    input.destinationParentProjection.containerKeks,
  );
  const principalPolicies = input.principalPolicies;
  const parentManifest = input.destinationParentProjection.path.at(-1);
  if (!parentManifest)
    throw new Error("Container move destination parent is missing");
  return {
    principalPolicies,
    ...(await buildContainerRotationWraps({
      containerKey: input.containerKey,
      containerKeyEpochId: input.containerKeyEpochId,
      manifestHash: input.manifestHash,
      operationLabel: "Container move",
      parentKek: input.destinationParentKek,
      parentPublicKey: readContainerState(parentManifest).containerKeyPublicKey,
      principalPolicies,
      resolveUserKey: input.resolveProjectionUserKey,
      state: input.state,
    })),
  };
}
