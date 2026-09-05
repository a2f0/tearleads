import type {
  AnyVerifiedPrincipalPolicy,
  ContainerAccessManifestState,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type { AccessManifestBundleWire } from "@tearleads/validators/request";
import { readCanonicalRecord } from "../../keyingCanonicalJson";
import type { ExecSql } from "../../sqlite/sqlSchema";
import type { AuthoredContainerMutationHead } from "./mutationAcknowledgement";

export interface HeldContainerHead {
  readonly bundle: AccessManifestBundleWire;
  readonly state: ContainerAccessManifestState;
}

interface HeldContainers {
  readonly heads: Map<string, HeldContainerHead>;
  readonly policies: Map<
    string,
    {
      readonly organizationId: string;
      readonly policy: AnyVerifiedPrincipalPolicy;
    }
  >;
}

// Opportunistic, process-local evidence, not a persistent cache or freshness
// oracle. No secret keys are retained. Eviction merely limits cascade coverage.
const heldByDatabase = new WeakMap<ExecSql, HeldContainers>();
// Executor-wide limits: another organization's activity may evict evidence,
// which only skips optional recitations and never changes durable checkpoints.
const MAX_HEADS = 256;
const MAX_POLICIES = 512;

function heldContainers(execSql: ExecSql): HeldContainers {
  let held = heldByDatabase.get(execSql);
  if (!held) {
    held = { heads: new Map(), policies: new Map() };
    heldByDatabase.set(execSql, held);
  }
  return held;
}

function boundedSet<T>(
  map: Map<string, T>,
  key: string,
  value: T,
  max: number,
) {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function rememberHead(
  execSql: ExecSql,
  head: Pick<VerifiedContainerAccessManifest, "state" | "manifestHash">,
  build: () => HeldContainerHead,
): void {
  const heads = heldContainers(execSql).heads;
  const previous = heads.get(head.state.containerId);
  if (previous && previous.state.epoch >= head.state.epoch) {
    if (previous.bundle.manifestHash === head.manifestHash) {
      boundedSet(heads, head.state.containerId, previous, MAX_HEADS);
    }
    return;
  }
  boundedSet(
    heads,
    head.state.containerId,
    structuredClone(build()),
    MAX_HEADS,
  );
}

/** Called only after the complete projection and its durable pins validate. */
export function rememberVerifiedContainerHeads(input: {
  readonly organizationId: string;
  readonly execSql: ExecSql;
  readonly heads: readonly VerifiedContainerAccessManifest[];
  readonly policies: readonly AnyVerifiedPrincipalPolicy[];
}): void {
  for (const head of input.heads) {
    if (head.state.organizationId !== input.organizationId) {
      throw new Error("Held container head belongs to another organization");
    }
  }
  for (const head of input.heads) {
    rememberHead(input.execSql, head, () => ({
      state: head.state,
      bundle: {
        event: readCanonicalRecord(head.event, "Verified container event"),
        manifest: readCanonicalRecord(
          head.manifest,
          "Verified container manifest",
        ),
        manifestHash: head.manifestHash,
        state: readCanonicalRecord(head.state, "Verified container state"),
      },
    }));
  }
  const policies = heldContainers(input.execSql).policies;
  for (const policy of input.policies) {
    const key = `${input.organizationId}:${policy.principalType}:${policy.principalId}`;
    const previous = policies.get(key);
    if (previous && previous.policy.version > policy.version) continue;
    if (
      previous?.policy.version === policy.version &&
      previous.policy.stateHash !== policy.stateHash
    )
      continue;
    boundedSet(
      policies,
      key,
      { organizationId: input.organizationId, policy: structuredClone(policy) },
      MAX_POLICIES,
    );
  }
}

/** Caller must first correlate the exact response and durably acknowledge it. */
export function rememberAcknowledgedContainerHead(
  execSql: ExecSql,
  plan: Pick<
    AuthoredContainerMutationHead,
    "body" | "event" | "eventHash" | "manifest" | "manifestHash" | "state"
  >,
): HeldContainerHead {
  const head: HeldContainerHead = {
    state: plan.state,
    bundle: {
      event: readCanonicalRecord(
        {
          event: plan.event,
          eventHash: plan.eventHash,
          body: plan.body,
        },
        "Acknowledged container event",
      ),
      manifest: readCanonicalRecord(
        plan.manifest,
        "Acknowledged container manifest",
      ),
      manifestHash: plan.manifestHash,
      state: readCanonicalRecord(plan.state, "Acknowledged container state"),
    },
  };
  rememberHead(execSql, plan, () => head);
  return head;
}

export function heldContainerSnapshot(
  execSql: ExecSql,
  organizationId: string,
) {
  const held = heldContainers(execSql);
  return {
    heads: new Map(
      [...held.heads]
        .filter(([, head]) => head.state.organizationId === organizationId)
        .map(([id, head]) => [id, structuredClone(head)] as const),
    ),
    policies: [...held.policies.values()]
      .filter((entry) => entry.organizationId === organizationId)
      .map((entry) => structuredClone(entry.policy)),
  };
}

/** Resolve parent edges only; parentManifestHash is historical keying evidence. */
export function heldContainerPath(
  heads: ReadonlyMap<string, HeldContainerHead>,
  containerId: string,
): HeldContainerHead[] | null {
  const path: HeldContainerHead[] = [];
  const seen = new Set<string>();
  let id: string | null = containerId;
  while (id !== null) {
    if (seen.has(id) || path.length >= 100) return null;
    seen.add(id);
    const head = heads.get(id);
    if (!head) return null;
    path.unshift(head);
    id = head.state.parentContainerId;
  }
  return path;
}
