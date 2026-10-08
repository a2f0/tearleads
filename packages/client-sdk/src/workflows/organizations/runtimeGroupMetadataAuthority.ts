import type {
  ContainerAccessManifestState,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import {
  createRuntimePrincipalPolicyCurrentResolver,
  type PrincipalPolicyRecoveryRuntime,
} from "../principals/runtimePolicyRecovery";
import { createCurrentGroupMetadataContainerVerifier } from "./currentGroupMetadataAuthority";

/** Remote metadata destinations require the same private authority as name reads. */
export async function verifyRuntimeGroupMetadataAuthority(input: {
  readonly runtime: PrincipalPolicyRecoveryRuntime;
  readonly organizationId: string;
  readonly state: ContainerAccessManifestState;
  readonly organizationReference?: ReferencedPrincipalHead | undefined;
  readonly stillCurrent: () => boolean;
}): Promise<void> {
  const resolveCurrentPolicy = createRuntimePrincipalPolicyCurrentResolver(
    input.runtime,
  );
  if (!resolveCurrentPolicy)
    throw new ProjectionDependencyUnavailableError(
      "Group metadata requires private paged recovery",
    );
  await createCurrentGroupMetadataContainerVerifier({
    execSql: input.runtime.infra.execSql,
    organizationId: input.organizationId,
    resolveCurrentPolicy,
    stillCurrent: input.stillCurrent,
  })(input.state, input.organizationReference);
}
