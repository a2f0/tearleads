import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { rethrowKeyingVerificationError } from "../data/keyingProjectionVerification/error";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import {
  loadLocalOrganizationGroupContainers,
  loadLocalOrganizationPolicyReference,
} from "../workflows/organizations/localReadModelDetails";
import type { ContainerContents } from "./containerContents";
import {
  type GroupGrantReshareOutcome,
  runSweepWithRetry,
} from "./organizationGroupGrantReshareRetry";
import type { InternalWorkflowRuntimeInput } from "./workflowRuntime";

type ContainerTree = ReturnType<ContainerContents["openTree"]>;

/**
 * Run a group policy mutation and sweep its grants once the head is known.
 *
 * The sweep is scheduled from `finally`, not from the success path. A mutation
 * can reject *after* its policy write commits — an ambiguous response, a failed
 * root re-wrap reconciliation, a cache write — and
 * `recoverOrganizationRootRewrapAfterMutationFailure` deliberately rethrows the
 * original error in exactly that case. The group has still rotated, so every
 * container wrapped to it is still stale; skipping the sweep on the throwing
 * path would strand precisely the rotations that most need repairing. The
 * captured head is the signal that the commit happened: absent it, the guard in
 * `scheduleGroupGrantReshareAfterRotation` makes this a no-op.
 */
export async function withGroupGrantReshareAfterRotation<T>(input: {
  containerContents: ContainerContents;
  mutatedGroupId: string;
  mutation: Promise<T>;
  readExpectedGroupHead: () => ReferencedPrincipalHead | null;
  reconcileReadModel: () => Promise<unknown>;
  runtime: InternalWorkflowRuntimeInput;
  scheduleRetry?: ((retry: () => void, delayMs: number) => void) | undefined;
  shouldContinue?: (() => boolean) | undefined;
  signingContext: { organizationId: string; signerUserId: string };
}): Promise<T> {
  try {
    return await input.mutation;
  } finally {
    scheduleGroupGrantReshareAfterRotation({
      containerContents: input.containerContents,
      expectedGroupHead: input.readExpectedGroupHead(),
      mutatedGroupId: input.mutatedGroupId,
      reconcileReadModel: input.reconcileReadModel,
      runtime: input.runtime,
      ...(input.scheduleRetry ? { scheduleRetry: input.scheduleRetry } : {}),
      ...(input.shouldContinue ? { shouldContinue: input.shouldContinue } : {}),
      signingContext: input.signingContext,
    });
  }
}

/**
 * Start the sweep for a group mutation whose policy write has committed.
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
  reconcileReadModel: () => Promise<unknown>;
  runtime: InternalWorkflowRuntimeInput;
  scheduleRetry?: ((retry: () => void, delayMs: number) => void) | undefined;
  shouldContinue?: (() => boolean) | undefined;
  signingContext: { organizationId: string; signerUserId: string };
}): void {
  if (!input.expectedGroupHead || input.runtime.infra.dbStatus !== "ready") {
    return;
  }
  const shouldContinue = input.shouldContinue ?? (() => true);
  const head = input.expectedGroupHead;
  const sweep = () =>
    reshareGroupContainerGrantsAfterRotation({
      containerContents: input.containerContents,
      currentUserId: input.signingContext.signerUserId,
      execSql: input.runtime.infra.execSql,
      expectedGroupHead: head,
      log: (message) => input.runtime.util.log(message),
      mutatedGroupId: input.mutatedGroupId,
      organizationId: input.signingContext.organizationId,
      reconcileReadModel: input.reconcileReadModel,
      shouldContinue,
    });

  // A second rotation on the same group supersedes the first: without this the
  // superseded loop keeps reconciling and re-listing for its whole window,
  // repairing toward a head that is no longer current.
  const sweepKey = `${input.signingContext.organizationId}:${input.mutatedGroupId}`;
  const superseded = activeSweeps.get(sweepKey);
  superseded?.cancel();
  const cancellation = { cancelled: false };
  activeSweeps.set(sweepKey, {
    cancel: () => {
      cancellation.cancelled = true;
    },
  });

  void runSweepWithRetry({
    log: (message) => input.runtime.util.log(message),
    logError: (message, cause) => input.runtime.util.logError(message, cause),
    mutatedGroupId: input.mutatedGroupId,
    refresh: () => input.containerContents.openTree().refresh(),
    scheduleRetry: input.scheduleRetry ?? defaultScheduleRetry,
    shouldContinue: () => !cancellation.cancelled && shouldContinue(),
    sweep,
  }).finally(() => {
    if (activeSweeps.get(sweepKey)?.cancel === undefined) {
      return;
    }
    if (cancellation.cancelled) {
      return;
    }
    activeSweeps.delete(sweepKey);
  });
}

/** In-flight sweeps by `organizationId:groupId`, so a rotation supersedes. */
const activeSweeps = new Map<string, { cancel: () => void }>();

function defaultScheduleRetry(retry: () => void, delayMs: number): void {
  setTimeout(retry, delayMs);
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
 *
 * Scope: candidates come from the mutated group's own organization read model,
 * so a grant held in a DIFFERENT organization is not enumerated here. Whether
 * the access plane permits such a grant at all was not established; this is the
 * same scope the reserved-principal re-shares already work within, not a
 * narrowing of it.
 */
export async function reshareGroupContainerGrantsAfterRotation(input: {
  containerContents: ContainerContents;
  currentUserId: string;
  execSql: ExecSql;
  expectedGroupHead: ReferencedPrincipalHead;
  log: (message: string) => void;
  mutatedGroupId: string;
  organizationId: string;
  reconcileReadModel: () => Promise<unknown>;
  shouldContinue: () => boolean;
}): Promise<GroupGrantReshareOutcome> {
  // The read model is a local cache. A grant created since the last reconcile
  // is absent from it, and a container missing from the candidate list is never
  // visited — the silent staleness this sweep exists to prevent. Pull first so
  // enumeration sees the server's current grant set.
  // The head is captured BEFORE the policy write, and the sweep also runs when
  // the mutation rejects, so a definitively failed commit would otherwise
  // re-wrap every cached container to an epoch that never existed. Confirm the
  // rotation first: the group's head in the read model must be the committed
  // one.
  //
  // Read locally before pulling. The caller has usually just reconciled, so the
  // rotation is already visible and a second pull would be one more request on
  // every group mutation for nothing. The pull is the fallback for when it is
  // not, which is also the only case where its cost buys anything.
  const readHead = () =>
    loadLocalOrganizationPolicyReference({
      currentUserId: input.currentUserId,
      execSql: input.execSql,
      organizationId: input.organizationId,
      principalId: input.mutatedGroupId,
      principalType: "group",
    });

  let head = await readHead();
  if (head?.stateHash !== input.expectedGroupHead.stateHash) {
    try {
      // The return value is deliberately NOT read as a freshness signal. A
      // failed reconciliation can resolve with the retained local projection
      // rather than undefined, so a defined result does not prove the pull
      // reached the server. The head re-read below is the evidence that holds.
      await input.reconcileReadModel();
    } catch (error) {
      rethrowKeyingVerificationError(error);
      input.log(
        `Organizations: group grant re-share read-model pull failed for group ${input.mutatedGroupId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // The reconcile can span a switch or a logout. Anything issued after that
    // would be this organization's repair travelling through another scope's
    // runtime, so re-check before reading or writing anything.
    if (!input.shouldContinue()) {
      return {
        complete: false,
        headConfirmed: false,
        unresolvedContainerIds: [],
      };
    }
    head = await readHead();
  }
  if (head?.stateHash !== input.expectedGroupHead.stateHash) {
    // Either the commit did not land or the pull is stale. Both mean this
    // device cannot yet tell which containers need repair, and sweeping on a
    // guess would re-share every one of them to the wrong epoch.
    return {
      complete: false,
      headConfirmed: false,
      unresolvedContainerIds: [],
    };
  }

  const granted = await loadLocalOrganizationGroupContainers({
    currentUserId: input.currentUserId,
    execSql: input.execSql,
    groupId: input.mutatedGroupId,
    organizationId: input.organizationId,
  });
  if (!granted) {
    // null is not "no grants": the projection is denied, reset, or otherwise
    // unreadable. Reporting complete here would retire the sweep on the very
    // race it exists to survive, leaving the grants stale with nothing left to
    // repair them.
    input.log(
      `Organizations: group grant re-share could not read the grant projection for group ${input.mutatedGroupId} in org ${input.organizationId}`,
    );
    return {
      complete: false,
      headConfirmed: true,
      unresolvedContainerIds: [],
    };
  }
  if (granted.containers.length === 0) {
    return { complete: true, headConfirmed: true, unresolvedContainerIds: [] };
  }

  const tree = input.containerContents.openTree();
  const unresolvedContainerIds: string[] = [];
  const unauthorizedContainerIds = new Set<string>();
  for (const container of granted.containers) {
    if (!input.shouldContinue()) {
      // A switch mid-loop: stop before issuing another write. What is left
      // stays unresolved, which is what keeps the outcome honest.
      return {
        complete: false,
        headConfirmed: true,
        unresolvedContainerIds: [
          ...unresolvedContainerIds,
          ...granted.containers
            .slice(granted.containers.indexOf(container))
            .map((pending) => pending.containerId),
        ],
      };
    }
    const repaired = await reshareOneGrantedContainer({
      accessLevel: container.accessLevel,
      containerId: container.containerId,
      expectedGroupHead: input.expectedGroupHead,
      log: input.log,
      mutatedGroupId: input.mutatedGroupId,
      onUnauthorized: (containerId) =>
        unauthorizedContainerIds.add(containerId),
      organizationId: input.organizationId,
      tree,
    });
    if (!repaired) {
      unresolvedContainerIds.push(container.containerId);
    }
  }
  return {
    complete: unresolvedContainerIds.length === 0,
    headConfirmed: true,
    // Nothing left but containers this signer may not touch: retrying cannot
    // change that, and an admin who can read them repairs them later.
    onlyUnauthorizedRemains:
      unresolvedContainerIds.length > 0 &&
      unresolvedContainerIds.every((id) => unauthorizedContainerIds.has(id)),
    unresolvedContainerIds,
  };
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
  onUnauthorized: (containerId: string) => void;
  organizationId: string;
  tree: ContainerTree;
}): Promise<boolean> {
  try {
    const prepared = await input.tree.prepareGroupRewrap(
      input.containerId,
      input.mutatedGroupId,
      input.accessLevel,
      { requireExistingGrant: true },
    );
    if (!prepared) {
      // Distinct from "not-granted": the container could not be resolved at
      // all, so its grant is neither confirmed nor refuted and it stays stale.
      // A silent return here would read as a clean sweep.
      input.log(
        `Organizations: group grant re-share was unavailable for container ${input.containerId} in org ${input.organizationId}`,
      );
      return false;
    }
    if (prepared.status === "not-granted") {
      // The manifest answered: this group holds no grant here. Nothing to
      // repair, so this is a resolved container, not a pending one.
      return true;
    }
    if (
      await prepared.isCurrent(
        input.expectedGroupHead,
        input.containerId,
        input.organizationId,
      )
    ) {
      return true;
    }
    if (!(await prepared.rewrap())) {
      input.log(
        `Organizations: group grant re-share did not apply for container ${input.containerId} in org ${input.organizationId}`,
      );
      return false;
    }
    return true;
  } catch (error) {
    rethrowKeyingVerificationError(error);
    if (isAuthorizationFailure(error)) {
      // A direct group admin may rotate membership without holding access to
      // every granted container. Aborting here would strand the containers
      // further down the list that this same signer CAN repair, so record it
      // and keep sweeping; the caller decides when to stop.
      input.log(
        `Organizations: group grant re-share is not permitted for container ${input.containerId} in org ${input.organizationId}`,
      );
      input.onUnauthorized(input.containerId);
      return false;
    }
    input.log(
      `Organizations: best-effort group grant re-share skipped for container ${input.containerId} in org ${input.organizationId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

function isAuthorizationFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }
  const { status } = error;
  return status === 403;
}
