import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { PrincipalPolicyPageResponse } from "@tearleads/validators/response";
import type { StoredPrincipalState } from "../../access/read/principalStateStore";
import { getVerifiedPrincipalPolicyForStateWithExecutor } from "./getCurrentPrincipalPolicy";
import { buildPrincipalPolicySnapshotPage } from "./principalPolicySnapshotPage";

/** Add authenticated current key artifacts to the bounded public history page. */
export async function buildPrincipalPolicyPage(
  executor: DatabaseSession,
  head: StoredPrincipalState,
  afterVersion: number,
): Promise<PrincipalPolicyPageResponse> {
  const page = await buildPrincipalPolicySnapshotPage(
    executor,
    head,
    afterVersion,
  );
  const { bundle } = await getVerifiedPrincipalPolicyForStateWithExecutor(
    executor,
    head,
  );
  return { ...bundle, ...page };
}
