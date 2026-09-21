import {
  type ContainerKekRecipientTarget,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
} from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type { MaterializedContainerRekeyPlan } from "../../../data/containers/shared/types";
import {
  canonicalKeyingJsonString,
  readCanonicalRecord,
  readCanonicalRecords,
} from "../../../data/keyingCanonicalJson";

const speculativeProjections = new WeakSet<ContainerWriterProjectionResponse>();

export function isSpeculativeContainerWriterProjection(
  projection: ContainerWriterProjectionResponse,
): boolean {
  return speculativeProjections.has(projection);
}

/**
 * What any rotation plan (rekey, revoke, move) holds in common: enough to say
 * what its container's path entry will be once the server accepts it.
 */
export interface RotationPlanArtifacts {
  readonly body: object;
  readonly containerId: string;
  readonly containerKeyEpochId: string;
  readonly event: MaterializedContainerRekeyPlan["plan"]["event"];
  readonly eventHash: string;
  readonly keyEpoch: MaterializedContainerRekeyPlan["plan"]["keyEpoch"];
  readonly manifest: MaterializedContainerRekeyPlan["plan"]["manifest"];
  readonly manifestHash: string;
  readonly previousManifest: MaterializedContainerRekeyPlan["plan"]["previousManifest"];
  readonly keyring: MaterializedContainerRekeyPlan["plan"]["keyring"];
  readonly state: MaterializedContainerRekeyPlan["plan"]["state"];
  readonly wraps: MaterializedContainerRekeyPlan["plan"]["wraps"];
}

function recipientTargets(
  plan: RotationPlanArtifacts,
): ContainerKekRecipientTarget[] {
  return plan.wraps
    .map((wrap) => ({
      recipientId: wrap.recipientId,
      recipientKeyEpochId: wrap.recipientKeyEpochId,
      recipientKeyFingerprint: wrap.recipientKeyFingerprint,
      recipientKind: wrap.recipientKind,
    }))
    .sort((left, right) =>
      canonicalKeyingJsonString(
        left,
        "Container rekey recipient",
      ).localeCompare(
        canonicalKeyingJsonString(right, "Container rekey recipient"),
      ),
    );
}

/**
 * The projection a rotation will leave behind, before the server has accepted
 * it. `ancestors` is the path above the container afterwards: unchanged for a
 * rekey or revoke, the destination parent's path for a move.
 */
export async function containerWriterProjectionFromRotationPlan(input: {
  ancestors?: Pick<ContainerWriterProjectionResponse, "containerKeks" | "path">;
  plan: RotationPlanArtifacts;
  previousProjection: ContainerWriterProjectionResponse;
}): Promise<ContainerWriterProjectionResponse> {
  const { plan } = input;
  const previousManifest = input.previousProjection.path.at(-1);
  const previousKek = input.previousProjection.containerKeks.at(-1);
  if (
    !previousManifest ||
    !previousKek ||
    previousManifest.manifestHash !== plan.previousManifest.manifestHash ||
    previousKek.containerId !== plan.containerId
  ) {
    throw new Error("Container rekey projection predecessor mismatch");
  }
  const targets = recipientTargets(plan);
  const nextManifest = {
    event: {
      body: readCanonicalRecord(plan.body, "Container rekey body"),
      event: readCanonicalRecord(plan.event, "Container rekey event"),
      eventHash: plan.eventHash,
    },
    manifest: readCanonicalRecord(plan.manifest, "Container rekey manifest"),
    manifestHash: plan.manifestHash,
    state: readCanonicalRecord(plan.state, "Container rekey state"),
  };
  const nextKek = {
    accessManifestHash: plan.manifestHash,
    containerId: plan.containerId,
    containerKeyEpoch: plan.keyEpoch.keyEpoch,
    containerKeyEpochId: plan.containerKeyEpochId,
    containerManifestHistory: [
      previousManifest,
      ...previousKek.containerManifestHistory,
    ],
    keyEpoch: readCanonicalRecord(plan.keyEpoch, "Container rekey key epoch"),
    keyEpochHash: await computeContainerKeyEpochHash(plan.keyEpoch),
    keyring: { ...plan.keyring },
    keyTargetHash: await computeContainerKekRecipientTargetHash(targets),
    parentContainerKeyEpochId: plan.keyEpoch.parentContainerKeyEpochId,
    recipientTargets: readCanonicalRecords(
      targets,
      "Container rekey recipient targets",
    ),
    wraps: readCanonicalRecords(plan.wraps, "Container rekey wraps"),
  };
  const ancestors = input.ancestors ?? {
    containerKeks: input.previousProjection.containerKeks.slice(0, -1),
    path: input.previousProjection.path.slice(0, -1),
  };
  const projection = {
    ...input.previousProjection,
    path: [...ancestors.path, nextManifest],
    containerKeks: [...ancestors.containerKeks, nextKek],
  };
  speculativeProjections.add(projection);
  return projection;
}

export function containerWriterProjectionFromRekeyPlan(input: {
  materializedPlan: Pick<
    MaterializedContainerRekeyPlan,
    "containerKey" | "plan"
  >;
  previousProjection: ContainerWriterProjectionResponse;
}): Promise<ContainerWriterProjectionResponse> {
  return containerWriterProjectionFromRotationPlan({
    plan: input.materializedPlan.plan,
    previousProjection: input.previousProjection,
  });
}

/**
 * A descendant's served projection, re-rooted on rotations the server has not
 * accepted yet: `rotated` replaces the path down to and including its own
 * container. Null when the descendant does not sit below that container.
 */
export function rebaseContainerWriterProjection(
  descendant: ContainerWriterProjectionResponse,
  rotated: Pick<ContainerWriterProjectionResponse, "containerKeks" | "path">,
): ContainerWriterProjectionResponse | null {
  const rotatedId = rotated.containerKeks.at(-1)?.containerId;
  const index = descendant.containerKeks.findIndex(
    (kek) => kek.containerId === rotatedId,
  );
  if (rotatedId === undefined || index < 0) return null;
  if (index === descendant.containerKeks.length - 1) return null;
  const projection = {
    ...descendant,
    path: [...rotated.path, ...descendant.path.slice(index + 1)],
    containerKeks: [
      ...rotated.containerKeks,
      ...descendant.containerKeks.slice(index + 1),
    ],
  };
  speculativeProjections.add(projection);
  return projection;
}
