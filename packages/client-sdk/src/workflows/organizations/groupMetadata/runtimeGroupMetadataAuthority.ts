import type {
  ContainerAccessManifestState,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import { ProjectionDependencyUnavailableError } from "../../../data/shared/dependencyUnavailable";
import type { PrincipalPolicyRuntime } from "../../principals/principalPolicyService";
import { createCurrentGroupMetadataContainerVerifier } from "./currentGroupMetadataAuthority";

/** Remote metadata destinations require the same private authority as name reads. */
export async function verifyRuntimeGroupMetadataAuthority(input: {
  readonly runtime: PrincipalPolicyRuntime;
  readonly organizationId: string;
  readonly state: ContainerAccessManifestState;
  readonly organizationReference?: ReferencedPrincipalHead | undefined;
  readonly stillCurrent: () => boolean;
}): Promise<void> {
  const resolveCurrentPolicy =
    input.runtime.principalPolicies.createCurrentPolicyResolver();
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
