import type { VerifiedPrincipalPolicy } from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { uniquePrincipalPolicies } from "../../../data/containers/shared/principalPolicies";
import {
  collectContainerWriterProjectionPrincipalPolicies,
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
} from "../../../data/keyingProjectionVerification";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

/**
 * Shared by rekey and revoke. Lives apart from both: background descendant
 * repair imports the rekey planner, and revoke schedules that repair, so
 * declaring this in revoke would close a dependency cycle.
 */
export async function collectContainerRevokePrincipalPolicies(input: {
  execSql: ExecSql;
  persistVerificationCheckpoints?: boolean | undefined;
  previousProjection: ContainerWriterProjectionResponse;
  resolveUserKey: ProjectionUserKeyResolver;
  stillCurrent?: (() => boolean) | undefined;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<VerifiedPrincipalPolicy[]> {
  return uniquePrincipalPolicies(
    await collectContainerWriterProjectionPrincipalPolicies({
      execSql: input.execSql,
      persistVerificationCheckpoints: input.persistVerificationCheckpoints,
      projection: input.previousProjection,
      resolveUserKey: input.resolveUserKey,
      stillCurrent: input.stillCurrent,
      warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
    }),
  );
}
