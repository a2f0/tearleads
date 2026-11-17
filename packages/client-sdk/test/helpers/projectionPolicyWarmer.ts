import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type {
  PrincipalPolicyBundleResponse,
  ProjectionPolicyEvidenceResponse,
} from "@tearleads/validators/response";
import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../src/data/keyingProjectionVerification/types";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import { recoverProjectionPolicyHistory } from "../../src/workflows/principals/publicHistory/recoverProjectionPolicyHistory";
import { projectionHistoryPages } from "./projectionPolicyPages";

export function projectionPolicyWarmer(input: {
  readonly bundles: readonly PrincipalPolicyBundleResponse[];
  readonly execSql: ExecSql;
  readonly resolveUserKey: ProjectionUserKeyResolver;
}): ReferencedPrincipalPolicyWarmer {
  return Object.assign(async () => {}, {
    async resolveProjectionHistory(request: {
      readonly evidence: ProjectionPolicyEvidenceResponse;
      readonly organizationId: string;
      readonly references: readonly ReferencedPrincipalHead[];
      readonly stillCurrent?: (() => boolean) | undefined;
    }) {
      const stillCurrent = () => request.stillCurrent?.() !== false;
      const policies = await recoverProjectionPolicyHistory({
        ...request,
        historyReader: projectionHistoryPages(input.bundles),
        execSql: input.execSql,
        resolveTrustedUserIdentity: input.resolveUserKey,
        protection: {
          localKey: new Uint8Array(32).fill(19),
          context: "projection-history-test",
        },
        stillCurrent,
      });
      return { policies, stillCurrent };
    },
  });
}
