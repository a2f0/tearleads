import type {
  ContainerAccessManifestState,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import type {
  ContainerKekResponse,
  ContainerWriterProjectionResponse,
} from "@symcrypt/validators/response";
import { uniquePrincipalPolicies } from "../../../data/containers/shared/principalPolicies";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { buildContainerRotationWraps } from "./rotationWraps";

async function collectContainerMovePrincipalPolicies(input: {
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
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  destinationParentKek: ContainerKekResponse;
  destinationParentKey: Uint8Array;
  destinationParentProjection: ContainerWriterProjectionResponse;
  execSql: ExecSql;
  manifestHash: string;
  previousProjection: ContainerWriterProjectionResponse;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  state: ContainerAccessManifestState;
  stillCurrent?: (() => boolean) | undefined;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}) {
  const principalPolicies = await collectContainerMovePrincipalPolicies({
    destinationParentProjection: input.destinationParentProjection,
    execSql: input.execSql,
    previousProjection: input.previousProjection,
    resolveUserKey: input.resolveProjectionUserKey,
    stillCurrent: input.stillCurrent,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  return {
    principalPolicies,
    ...(await buildContainerRotationWraps({
      containerKey: input.containerKey,
      containerKeyEpochId: input.containerKeyEpochId,
      manifestHash: input.manifestHash,
      operationLabel: "Container move",
      parentKek: input.destinationParentKek,
      parentKekMaterial: input.destinationParentKey,
      principalPolicies,
      resolveUserKey: input.resolveProjectionUserKey,
      state: input.state,
    })),
  };
}
