import { KeyingVerificationError } from "@tearleads/crypto";
import {
  type HeldContainerHead,
  heldContainerPath,
  heldContainerSnapshot,
  rememberAcknowledgedContainerHead,
} from "../../../data/containers/shared/heldContainerHeads";
import type { AuthoredContainerMutationHead } from "../../../data/containers/shared/mutationAcknowledgement";
import type { ContainerReciteApi } from "../../../data/containers/shared/reciteApi";
import type { ContainerMutationAuthor } from "../../../data/containers/shared/types";
import { loadAccessManifestCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import {
  advanceLocallyAcknowledgedAccessManifestHeadsAtomically,
  locallyAuthoredAccessManifestHead,
} from "../../../data/persistence/locallyAcknowledgedCheckpointPersistence";
import type { SecurityIncidentReporter } from "../../../data/securityIncidents";
import {
  type ExecSql,
  resolveCanonicalExecSql,
} from "../../../data/sqlite/sqlSchema";
import {
  assertContainerReciteAcknowledgement,
  buildContainerRecitePlan,
} from "./recitePlan";

const MAX_RECITES_PER_PASS = 8;
const RECITE_SPACING_MS = 250;

interface ReciteHeldDescendantsInput {
  readonly apiClient: ContainerReciteApi;
  readonly author: ContainerMutationAuthor;
  readonly ancestorIds: readonly string[];
  readonly execSql: ExecSql;
  readonly reportSecurityIncident: SecurityIncidentReporter;
  readonly stillCurrent?: (() => boolean) | undefined;
}

async function pathIsPinned(
  execSql: ExecSql,
  path: readonly HeldContainerHead[],
): Promise<boolean> {
  for (const head of path) {
    const checkpoint = await loadAccessManifestCheckpoint(
      execSql,
      "container",
      head.state.organizationId,
      head.state.containerId,
    );
    if (checkpoint?.manifestHash !== head.bundle.manifestHash) return false;
  }
  return true;
}

async function recitePinnedPath(
  input: ReciteHeldDescendantsInput,
  path: readonly HeldContainerHead[],
  policies: ReturnType<typeof heldContainerSnapshot>["policies"],
): Promise<HeldContainerHead | null> {
  const plan = await buildContainerRecitePlan({
    author: input.author,
    path,
    policies,
  });
  if (input.stillCurrent?.() === false) return null;
  const id = plan.state.containerId;
  const response = await input.apiClient.reciteContainer(id, plan.request, {
    reportErrors: false,
  });
  if (!response || input.stillCurrent?.() === false) return null;
  try {
    assertContainerReciteAcknowledgement(plan, response);
  } catch (error) {
    const failure =
      error instanceof KeyingVerificationError
        ? error
        : new KeyingVerificationError(
            "invalid_shape",
            "Malformed re-citation acknowledgement",
          );
    await input.reportSecurityIncident(failure, {
      operation: "container.recite.acknowledge",
      objectKind: "container",
      objectId: id,
      organizationId: input.author.organizationId,
      evidenceHashes: { plannedManifestHash: plan.manifestHash },
    });
    return null;
  }
  let acknowledged: boolean;
  try {
    acknowledged =
      await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
        execSql: input.execSql,
        heads: [locallyAuthoredAccessManifestHead(plan)],
        stillCurrent: input.stillCurrent,
      });
  } catch (error) {
    if (!(error instanceof KeyingVerificationError)) throw error;
    await input.reportSecurityIncident(error, {
      operation: "container.recite.acknowledge",
      objectKind: "container",
      objectId: id,
      organizationId: input.author.organizationId,
      evidenceHashes: { plannedManifestHash: plan.manifestHash },
    });
    return null;
  }
  if (!acknowledged || input.stillCurrent?.() === false) return null;
  return rememberAcknowledgedContainerHead(input.execSql, plan);
}

async function waitForPinnedPath(
  input: ReciteHeldDescendantsInput,
  path: readonly HeldContainerHead[],
  attempts: number,
): Promise<boolean> {
  if (!(await pathIsPinned(input.execSql, path))) return false;
  if (attempts > 0) {
    await new Promise((resolve) => setTimeout(resolve, RECITE_SPACING_MS));
    if (!(await pathIsPinned(input.execSql, path))) return false;
  }
  return input.stillCurrent?.() !== false;
}

/**
 * Best effort only: never fetches a subtree or policy, never retries conflicts,
 * and never turns an unavailable/missing descendant into an ancestor refusal.
 * The API checks admin authority and exact current paths again at commit time.
 */
export async function reciteHeldDescendants(
  input: ReciteHeldDescendantsInput,
): Promise<void> {
  const snapshot = heldContainerSnapshot(
    input.execSql,
    input.author.organizationId,
  );
  const ancestors = new Set(input.ancestorIds);
  const candidates = [...snapshot.heads.keys()]
    .map((id) => ({ id, path: heldContainerPath(snapshot.heads, id) }))
    .filter(
      ({ id, path }) =>
        !ancestors.has(id) &&
        path?.some((head) => ancestors.has(head.state.containerId)),
    )
    .sort((a, b) => (a.path?.length ?? 0) - (b.path?.length ?? 0));
  let attempts = 0;
  for (const { id } of candidates) {
    if (attempts >= MAX_RECITES_PER_PASS) return;
    if (input.stillCurrent?.() === false) return;
    try {
      const path = heldContainerPath(snapshot.heads, id);
      if (!path) continue;
      // Every held head must still equal its durable pin. A failed projection,
      // concurrent mutation, or verify-without-persist result cannot become an
      // implicit checkpoint advance through this opportunistic path.
      if (!(await waitForPinnedPath(input, path, attempts))) continue;
      attempts += 1;
      const updated = await recitePinnedPath(input, path, snapshot.policies);
      if (updated) snapshot.heads.set(id, updated);
    } catch {
      // A later reconciliation can observe any committed response we lost.
      // Do not retry here or change the result of the acknowledged ancestor.
    }
  }
}

const running = new WeakSet<ExecSql>();

/** Called only after exact acknowledgement of the original mutation. */
export function scheduleHeldDescendantRecitations(
  input: Omit<ReciteHeldDescendantsInput, "ancestorIds"> & {
    readonly plans: readonly AuthoredContainerMutationHead[];
  },
): void {
  if (input.stillCurrent?.() === false) return;
  try {
    for (const plan of input.plans) {
      rememberAcknowledgedContainerHead(input.execSql, plan);
    }
  } catch {
    return;
  }
  const canonical = resolveCanonicalExecSql(input.execSql);
  if (running.has(canonical)) return;
  running.add(canonical);
  void Promise.resolve()
    .then(() =>
      reciteHeldDescendants({
        apiClient: input.apiClient,
        author: input.author,
        // Background work outlives the caller's lock scope. Use the canonical
        // executor so its checkpoint write acquires a new mutation lock.
        execSql: canonical,
        reportSecurityIncident: input.reportSecurityIncident,
        stillCurrent: input.stillCurrent,
        ancestorIds: input.plans.map((plan) => plan.containerId),
      }),
    )
    .catch(() => {
      // Failure is deliberately independent of the user's completed mutation.
    })
    .finally(() => running.delete(canonical));
}
