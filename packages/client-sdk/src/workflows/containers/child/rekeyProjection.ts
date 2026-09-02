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

function recipientTargets(
  plan: MaterializedContainerRekeyPlan["plan"],
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

export async function containerWriterProjectionFromRekeyPlan(input: {
  materializedPlan: Pick<
    MaterializedContainerRekeyPlan,
    "containerKey" | "plan"
  >;
  previousProjection: ContainerWriterProjectionResponse;
}): Promise<ContainerWriterProjectionResponse> {
  const { plan } = input.materializedPlan;
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

  return {
    ...input.previousProjection,
    path: [...input.previousProjection.path.slice(0, -1), nextManifest],
    containerKeks: [
      ...input.previousProjection.containerKeks.slice(0, -1),
      nextKek,
    ],
  };
}
