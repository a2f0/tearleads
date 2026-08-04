import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { rethrowKeyingVerificationError } from "../data/keyingProjectionVerification/error";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import { loadLocalOrganizationGroupContainers } from "../workflows/organizations/localReadModelDetails";
import type { ContainerContents } from "./containerContents";
import type { InternalWorkflowRuntimeInput } from "./workflowRuntime";

type ContainerTree = ReturnType<ContainerContents["openTree"]>;

/** Retry pacing mirrors the root re-share coordinator. */
const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_ATTEMPTS = 6;

interface GroupGrantReshareOutcome {
  /** Every granted container was resolved against a freshly pulled read model. */
  readonly complete: boolean;
  /** Containers left stale: unresolvable, or a re-wrap that did not apply. */
  readonly unresolvedContainerIds: readonly string[];
}

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
  signingContext: { organizationId: string; signerUserId: string };
}): void {
  if (!input.expectedGroupHead || input.runtime.infra.dbStatus !== "ready") {
    return;
  }
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
    });

  void runSweepWithRetry({
    logError: (message, cause) => input.runtime.util.logError(message, cause),
    log: (message) => input.runtime.util.log(message),
    mutatedGroupId: input.mutatedGroupId,
    scheduleRetry: input.scheduleRetry ?? defaultScheduleRetry,
    sweep,
  });
}

function defaultScheduleRetry(retry: () => void, delayMs: number): void {
  setTimeout(retry, delayMs);
}

/**
 * Re-run the sweep until it reports completion, backing off between attempts.
 *
 * An incomplete sweep leaves containers pinned to the superseded epoch, so the
 * members this repair exists for stay locked out of them. One best-effort pass
 * would strand exactly the transient cases — a container not yet hydrated, a
 * read-model pull that declined while offline — that a later attempt resolves.
 * Pacing and the 60s ceiling mirror the root re-share coordinator; the attempt
 * cap bounds a permanently unreachable container instead of retrying forever.
 */
async function runSweepWithRetry(input: {
  log: (message: string) => void;
  logError: (message: string, cause?: unknown) => void;
  mutatedGroupId: string;
  scheduleRetry: (retry: () => void, delayMs: number) => void;
  sweep: () => Promise<GroupGrantReshareOutcome>;
}): Promise<void> {
  let delayMs = INITIAL_RETRY_DELAY_MS;
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    let outcome: GroupGrantReshareOutcome | null = null;
    try {
      outcome = await input.sweep();
    } catch (error) {
      input.logError(
        `Organizations: group grant re-share failed for group ${input.mutatedGroupId}`,
        error,
      );
    }
    if (outcome?.complete) {
      return;
    }
    if (attempt === MAX_RETRY_ATTEMPTS) {
      input.log(
        `Organizations: group grant re-share gave up for group ${input.mutatedGroupId} after ${attempt} attempts; unresolved: ${outcome?.unresolvedContainerIds.join(", ") ?? "unknown"}`,
      );
      return;
    }
    await new Promise<void>((resolve) => {
      input.scheduleRetry(resolve, delayMs);
    });
    delayMs = Math.min(delayMs * 2, MAX_RETRY_DELAY_MS);
  }
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
  reconcileReadModel: () => Promise<unknown>;
}): Promise<GroupGrantReshareOutcome> {
  // The read model is a local cache. A grant created since the last reconcile
  // is absent from it, and a container missing from the candidate list is never
  // visited — the silent staleness this sweep exists to prevent. Pull first so
  // enumeration sees the server's current grant set.
  // reconcileAfterMutation resolves `undefined` when it declines to run —
  // offline, unauthenticated, or a different org — rather than throwing. Reading
  // that as a successful pull is what would let a stale cache pass for a fresh
  // one, so both the decline and the throw are treated as "not reconciled".
  let reconciled = false;
  try {
    reconciled = (await input.reconcileReadModel()) !== undefined;
  } catch (error) {
    rethrowKeyingVerificationError(error);
    input.log(
      `Organizations: group grant re-share read-model pull failed for group ${input.mutatedGroupId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!reconciled) {
    // Sweep the cached grants rather than nothing, but report it as incomplete
    // so the caller retries: a grant this view omits was never even visited.
    input.log(
      `Organizations: group grant re-share swept a stale read model for group ${input.mutatedGroupId}`,
    );
  }

  const granted = await loadLocalOrganizationGroupContainers({
    currentUserId: input.currentUserId,
    execSql: input.execSql,
    groupId: input.mutatedGroupId,
    organizationId: input.organizationId,
  });
  if (!granted || granted.containers.length === 0) {
    return { complete: reconciled, unresolvedContainerIds: [] };
  }

  const tree = input.containerContents.openTree();
  const unresolvedContainerIds: string[] = [];
  for (const container of granted.containers) {
    const repaired = await reshareOneGrantedContainer({
      accessLevel: container.accessLevel,
      containerId: container.containerId,
      expectedGroupHead: input.expectedGroupHead,
      log: input.log,
      mutatedGroupId: input.mutatedGroupId,
      organizationId: input.organizationId,
      tree,
    });
    if (!repaired) {
      unresolvedContainerIds.push(container.containerId);
    }
  }
  return {
    complete: reconciled && unresolvedContainerIds.length === 0,
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
    input.log(
      `Organizations: best-effort group grant re-share skipped for container ${input.containerId} in org ${input.organizationId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
