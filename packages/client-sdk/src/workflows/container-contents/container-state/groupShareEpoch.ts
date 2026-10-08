import {
  advanceVerifiedSharePolicies,
  loadVerifiedGroupSharePrincipalPolicy,
} from "../../containers";
import { createRuntimeCurrentSharePrincipalPolicy } from "../../containers/child/currentSharePrincipalPolicy";
import { createRuntimeGroupMetadataAccess } from "../../organizations/groupMetadataRuntime";
import type { ContainerWorkflowRuntime } from "./types";

export async function resolveCurrentGroupKeyEpoch(input: {
  // Bound here, in the one verified load a duplicate share performs, so a
  // duplicate never reports success for a group the user did not choose.
  expectedGroupName?: string | undefined;
  groupId: string;
  organizationId: string;
  runtime: ContainerWorkflowRuntime;
  stillCurrent?: (() => boolean) | undefined;
}): Promise<number | null> {
  if (input.stillCurrent?.() === false) return null;
  const readCurrent = createRuntimeCurrentSharePrincipalPolicy(input.runtime);
  if (readCurrent)
    return readCurrent(
      {
        expectedGroupName: input.expectedGroupName,
        groupId: input.groupId,
        organizationId: input.organizationId,
        stillCurrent: input.stillCurrent ?? (() => true),
      },
      async ({ policy }) => policy.keyEpoch,
    );
  const verified = await loadVerifiedGroupSharePrincipalPolicy({
    apiClient: input.runtime.apiClient,
    execSql: input.runtime.infra.execSql,
    expectedGroupName: input.expectedGroupName,
    readEncryptedName: (bundle) =>
      createRuntimeGroupMetadataAccess(
        input.runtime,
        input.organizationId,
        input.stillCurrent,
      ).readName(bundle),
    groupId: input.groupId,
    organizationId: input.organizationId,
    resolveTrustedUserIdentity: input.runtime.resolveTrustedUserIdentity,
    stillCurrent: input.stillCurrent,
  });
  if (input.stillCurrent?.() === false) return null;
  // Commit the verification immediately: this read stands alone (no enclosing
  // mutation advances it later), and an unadvanced checkpoint would let a
  // newer same-epoch policy be rolled back on the next fetch.
  await advanceVerifiedSharePolicies(
    input.runtime.infra.execSql,
    verified,
    input.stillCurrent,
  );
  return input.stillCurrent?.() === false ? null : verified.policy.keyEpoch;
}
