import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { getParentCreateContext } from "../../../data/containers/shared/projection";
import type { MaterializedContainerCreatePlan } from "../../../data/containers/shared/types";
import {
  readCanonicalRecord,
  readCanonicalRecords,
} from "../../../data/keyingCanonicalJson";

export function childContainerWriterProjectionFromCreatePlan(input: {
  materializedPlan: MaterializedContainerCreatePlan;
  parentProjection: ContainerWriterProjectionResponse;
}): ContainerWriterProjectionResponse {
  const { materializedPlan, parentProjection } = input;
  const { plan } = materializedPlan;
  const parentKek = getParentCreateContext(parentProjection).kek;

  return {
    containerId: plan.containerId,
    organizationId: plan.state.organizationId,
    path: [
      ...parentProjection.path,
      {
        event: {
          event: readCanonicalRecord(plan.event, "Container child event"),
          body: readCanonicalRecord(plan.body, "Container child body"),
          eventHash: plan.eventHash,
        },
        manifest: readCanonicalRecord(
          plan.manifest,
          "Container child manifest",
        ),
        manifestHash: plan.manifestHash,
        state: readCanonicalRecord(plan.state, "Container child state"),
      },
    ],
    containerKeks: [
      ...parentProjection.containerKeks,
      {
        containerId: plan.containerId,
        accessManifestHash: plan.manifestHash,
        containerKeyEpochId: plan.containerKeyEpochId,
        containerKeyEpoch: plan.keyEpoch.keyEpoch,
        keyEpoch: readCanonicalRecord(
          plan.keyEpoch,
          "Container child key epoch",
        ),
        keyEpochHash: plan.keyEpochHash,
        keyTargetHash: plan.keyTargetHash,
        containerManifestHistory: [],
        parentContainerKeyEpochId: parentKek.containerKeyEpochId,
        keyring: null,
        recipientTargets: readCanonicalRecords(
          plan.recipientTargets,
          "Container child recipient targets",
        ),
        wraps: readCanonicalRecords(plan.wraps, "Container child wraps"),
      },
    ],
  };
}
