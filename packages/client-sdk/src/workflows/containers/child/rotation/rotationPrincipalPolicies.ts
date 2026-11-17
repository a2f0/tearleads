import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { uniquePrincipalPolicies } from "../../../../data/containers/shared/principalPolicies";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  type PrincipalPolicyCache,
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
} from "../../../../data/keyingProjectionVerification";
import { openPrincipalPolicyBundleReader } from "../../../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import type { PrincipalPolicyCurrentEvidence } from "../../../../data/principalContracts/principalPolicyEvidence";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";

/**
 * Shared by rekey and revoke. Lives apart from both: background descendant
 * repair imports the rekey planner, and revoke schedules that repair, so
 * declaring this in revoke would close a dependency cycle.
 */
export async function collectContainerRevokePrincipalPolicies(input: {
  execSql: ExecSql;
  persistVerificationCheckpoints?: boolean | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  principalPolicyCache?: PrincipalPolicyCache | undefined;
  resolveUserKey: ProjectionUserKeyResolver;
  stillCurrent?: (() => boolean) | undefined;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<PrincipalPolicyCurrentEvidence[]> {
  return uniquePrincipalPolicies(
    await collectContainerWriterProjectionPrincipalPolicies({
      execSql: input.execSql,
      openPrincipalPolicyBundleReader,
      persistVerificationCheckpoints: input.persistVerificationCheckpoints,
      principalPolicyCache: input.principalPolicyCache,
      projection: input.previousProjection,
      resolveUserKey: input.resolveUserKey,
      stillCurrent: input.stillCurrent,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    }),
  );
}
