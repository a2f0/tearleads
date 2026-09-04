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
  readonly policies: Map<string, AnyVerifiedPrincipalPolicy>;
}

// Opportunistic, process-local evidence, not a persistent cache or freshness
// oracle. No secret keys are retained. Eviction merely limits cascade coverage.
const heldByDatabase = new WeakMap<ExecSql, HeldContainers>();
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

function rememberHead(execSql: ExecSql, head: HeldContainerHead): void {
  const heads = heldContainers(execSql).heads;
  const previous = heads.get(head.state.containerId);
  if (previous && previous.state.epoch >= head.state.epoch) return;
  boundedSet(heads, head.state.containerId, structuredClone(head), MAX_HEADS);
}

/** Called only after the complete projection and its durable pins validate. */
export function rememberVerifiedContainerHeads(input: {
  readonly execSql: ExecSql;
  readonly heads: readonly VerifiedContainerAccessManifest[];
  readonly policies: readonly AnyVerifiedPrincipalPolicy[];
}): void {
  for (const head of input.heads) {
    rememberHead(input.execSql, {
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
    });
  }
  const policies = heldContainers(input.execSql).policies;
  for (const policy of input.policies) {
    const key = `${policy.principalType}:${policy.principalId}`;
    if ((policies.get(key)?.version ?? 0) >= policy.version) continue;
    boundedSet(policies, key, policy, MAX_POLICIES);
  }
}

/** Caller must first correlate the exact response and durably acknowledge it. */
export function rememberAcknowledgedContainerHead(
  execSql: ExecSql,
  plan: Pick<
    AuthoredContainerMutationHead,
    "body" | "event" | "eventHash" | "manifest" | "manifestHash" | "state"
  >,
): void {
  rememberHead(execSql, {
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
  });
}

export function heldContainerSnapshot(
  execSql: ExecSql,
  organizationId: string,
) {
  const held = heldContainers(execSql);
  return {
    heads: new Map(
      [...held.heads].filter(
        ([, head]) => head.state.organizationId === organizationId,
      ),
    ),
    policies: [...held.policies.values()],
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
