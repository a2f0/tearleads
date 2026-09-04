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
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
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
  assertContainerReciteAcknowledgement(plan, response);
  const acknowledged =
    await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
      execSql: input.execSql,
      heads: [locallyAuthoredAccessManifestHead(plan)],
      stillCurrent: input.stillCurrent,
    });
  if (!acknowledged || input.stillCurrent?.() === false) return null;
  rememberAcknowledgedContainerHead(input.execSql, plan);
  return (
    heldContainerSnapshot(input.execSql, input.author.organizationId).heads.get(
      id,
    ) ?? null
  );
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
      if (attempts > 0) {
        await new Promise((resolve) => setTimeout(resolve, RECITE_SPACING_MS));
      }
      const pinned = await pathIsPinned(input.execSql, path);
      if (input.stillCurrent?.() === false) return;
      if (!pinned) continue;
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
  if (running.has(input.execSql)) return;
  running.add(input.execSql);
  void Promise.resolve()
    .then(() =>
      reciteHeldDescendants({
        ...input,
        ancestorIds: input.plans.map((plan) => plan.containerId),
      }),
    )
    .catch(() => {
      // Failure is deliberately independent of the user's completed mutation.
    })
    .finally(() => running.delete(input.execSql));
}
