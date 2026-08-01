import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import {
  type PrincipalPolicyCache,
  verifyContainerWriterProjection,
} from "../../keyingProjectionVerification";
import type { ExecSql } from "../../sqlite/sqlSchema";
import type { ProjectionVerificationOptions } from "./types";
import { resolveProjectionVerifier } from "./types";

export type UnwrapContainerKekPathInput = {
  execSql?: ExecSql | undefined;
  knownContainerKeks?: ReadonlyMap<string, Uint8Array> | undefined;
  principalPolicyCache?: PrincipalPolicyCache | undefined;
  projection: ContainerWriterProjectionResponse;
  secretKey: Uint8Array;
  verifiedByHash?: Map<string, VerifiedContainerAccessManifest> | undefined;
} & ProjectionVerificationOptions;

export async function verifyContainerKekPathProjection(
  input: UnwrapContainerKekPathInput,
): Promise<void> {
  if (input.projection.path.length !== input.projection.containerKeks.length) {
    throw new Error(
      "Container writer projection path and KEKs are inconsistent",
    );
  }
  const resolveProjectionUserKey = resolveProjectionVerifier(
    input,
    "Container KEK unwrap",
  );
  if (
    input.trustedLocalProjection === true ||
    resolveProjectionUserKey === null
  ) {
    return;
  }

  await verifyContainerWriterProjection({
    execSql: input.execSql,
    principalPolicyCache: input.principalPolicyCache,
    projection: input.projection,
    resolveUserKey: resolveProjectionUserKey,
    verifiedByHash: input.verifiedByHash,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
}
