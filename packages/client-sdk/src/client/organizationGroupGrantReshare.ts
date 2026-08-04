import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { rethrowKeyingVerificationError } from "../data/keyingProjectionVerification/error";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import { loadLocalOrganizationGroupContainers } from "../workflows/organizations/localReadModelDetails";
import type { ContainerContents } from "./containerContents";
import type { InternalWorkflowRuntimeInput } from "./workflowRuntime";

type ContainerTree = ReturnType<ContainerContents["openTree"]>;

/**
 * Start the sweep for a group mutation that has already committed.
 *
 * Fire-and-forget by design: the policy write is durable by this point, so a
 * container that cannot be repaired now must not surface as a failure of the
 * mutation itself. The sweep is idempotent, so the next mutation on the same
 * group repairs whatever this pass missed.
 */
export function scheduleGroupGrantReshareAfterRotation(input: {
  containerContents: ContainerContents;
  expectedGroupHead: ReferencedPrincipalHead | null;
  mutatedGroupId: string;
  runtime: InternalWorkflowRuntimeInput;
  signingContext: { organizationId: string; signerUserId: string };
}): void {
  if (!input.expectedGroupHead || input.runtime.infra.dbStatus !== "ready") {
    return;
  }
  void reshareGroupContainerGrantsAfterRotation({
    containerContents: input.containerContents,
    currentUserId: input.signingContext.signerUserId,
    execSql: input.runtime.infra.execSql,
    expectedGroupHead: input.expectedGroupHead,
    log: (message) => input.runtime.util.log(message),
    mutatedGroupId: input.mutatedGroupId,
    organizationId: input.signingContext.organizationId,
  }).catch((error: unknown) => {
    input.runtime.util.logError(
      `Organizations: group grant re-share failed for group ${input.mutatedGroupId}`,
      error,
    );
  });
}

/**
 * Best-effort re-share of every container directly granted to a group after
 * that group's key epoch rotates.
 *
 * A container KEK wrapped to a group names the group key epoch it was sealed
 * to, and the container's own signed manifest pins that head. Removing a member
 * shrinks the projection, which the crypto layer requires to mint a new key
 * epoch and fresh key material, so the wrap is left pinned to the superseded
 * epoch. Members present at that epoch still open it from their own envelope,
 * directly or by walking policy history. A member who joins afterwards never
 * had an envelope there and has no derivation path to one, so the container —
 * and every descendant reachable through its parent wrap — is silently
 * undecryptable for them while the read model still shows the grant.
 *
 * Re-wrapping to the committed head closes that gap. The reserved Admins and
 * Members principals already had targeted repairs for the root and org-metadata
 * containers; this is the same repair for the arbitrary containers a
 * user-created group is granted, which nothing covered.
 *
 * This never mints a NEW grant. The candidate list comes from the local read
 * model, which is server-fed, so `requireExistingGrant` makes each container's
 * signed manifest — not the projection — decide whether the group already holds
 * the grant. A fabricated row resolves to `not-granted` and is skipped rather
 * than becoming a grant.
 *
 * Containers already carrying the committed head are skipped via `isCurrent`,
 * so the root container repaired by the root coordinator on the same mutation
 * does not get re-shared twice.
 */
export async function reshareGroupContainerGrantsAfterRotation(input: {
  containerContents: ContainerContents;
  currentUserId: string;
  execSql: ExecSql;
  expectedGroupHead: ReferencedPrincipalHead;
  log: (message: string) => void;
  mutatedGroupId: string;
  organizationId: string;
}): Promise<void> {
  const granted = await loadLocalOrganizationGroupContainers({
    currentUserId: input.currentUserId,
    execSql: input.execSql,
    groupId: input.mutatedGroupId,
    organizationId: input.organizationId,
  });
  if (!granted || granted.containers.length === 0) {
    return;
  }

  const tree = input.containerContents.openTree();
  for (const container of granted.containers) {
    await reshareOneGrantedContainer({
      accessLevel: container.accessLevel,
      containerId: container.containerId,
      expectedGroupHead: input.expectedGroupHead,
      log: input.log,
      mutatedGroupId: input.mutatedGroupId,
      organizationId: input.organizationId,
      tree,
    });
  }
}

/**
 * One container's repair, isolated so an unreachable container cannot abort the
 * rest of the sweep.
 *
 * Availability failures are swallowed with a log: the group mutation has
 * already committed and must not appear to fail because a re-wrap could not be
 * applied. Identity integrity failures propagate — those mean a verified
 * projection disagreed with a trusted identity, which is never routine.
 */
async function reshareOneGrantedContainer(input: {
  accessLevel: Parameters<ContainerTree["prepareGroupRewrap"]>[2];
  containerId: string;
  expectedGroupHead: ReferencedPrincipalHead;
  log: (message: string) => void;
  mutatedGroupId: string;
  organizationId: string;
  tree: ContainerTree;
}): Promise<void> {
  try {
    const prepared = await input.tree.prepareGroupRewrap(
      input.containerId,
      input.mutatedGroupId,
      input.accessLevel,
      { requireExistingGrant: true },
    );
    if (!prepared || prepared.status === "not-granted") {
      return;
    }
    if (
      await prepared.isCurrent(
        input.expectedGroupHead,
        input.containerId,
        input.organizationId,
      )
    ) {
      return;
    }
    if (!(await prepared.rewrap())) {
      input.log(
        `Organizations: group grant re-share did not apply for container ${input.containerId} in org ${input.organizationId}`,
      );
    }
  } catch (error) {
    rethrowKeyingVerificationError(error);
    input.log(
      `Organizations: best-effort group grant re-share skipped for container ${input.containerId} in org ${input.organizationId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
