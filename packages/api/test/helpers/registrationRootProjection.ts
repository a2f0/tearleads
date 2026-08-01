import type {
  AccessEvent,
  AccessManifest,
  ContainerAccessManifestState,
  ContainerCreateAccessEventBody,
  ContainerKekRecipientTarget,
  ContainerKeyEpoch,
  ContainerKeyWrap,
} from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { toWireRecord, toWireRecords } from "./registrationWire";

interface RootContainerProjectionArtifacts {
  body: ContainerCreateAccessEventBody;
  containerKeyEpochId: string;
  event: AccessEvent;
  eventHash: string;
  keyEpoch: ContainerKeyEpoch;
  keyEpochHash: string;
  keyTargetHash: string;
  manifest: AccessManifest;
  manifestHash: string;
  recipientTargets: ContainerKekRecipientTarget[];
  state: ContainerAccessManifestState;
  wraps: ContainerKeyWrap[];
}

export function rootContainerProjectionFromArtifacts(
  artifacts: RootContainerProjectionArtifacts,
): ContainerWriterProjectionResponse {
  return {
    containerId: artifacts.state.containerId,
    organizationId: artifacts.state.organizationId,
    path: [
      {
        event: {
          event: toWireRecord(artifacts.event, "root container event"),
          body: toWireRecord(artifacts.body, "root container event body"),
          eventHash: artifacts.eventHash,
        },
        manifest: toWireRecord(artifacts.manifest, "root container manifest"),
        manifestHash: artifacts.manifestHash,
        state: toWireRecord(artifacts.state, "root container state"),
      },
    ],
    containerKeks: [
      {
        containerId: artifacts.state.containerId,
        accessManifestHash: artifacts.manifestHash,
        containerKeyEpochId: artifacts.containerKeyEpochId,
        containerKeyEpoch: artifacts.keyEpoch.keyEpoch,
        keyEpoch: toWireRecord(artifacts.keyEpoch, "root container key epoch"),
        keyEpochHash: artifacts.keyEpochHash,
        keyTargetHash: artifacts.keyTargetHash,
        containerManifestHistory: [],
        predecessorKeks: [],
        parentContainerKeyEpochId: null,
        recipientTargets: toWireRecords(
          artifacts.recipientTargets,
          "root container recipient targets",
        ),
        wraps: toWireRecords(artifacts.wraps, "root container wraps"),
      },
    ],
  };
}
