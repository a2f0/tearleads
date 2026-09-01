import type {
  AccessManifest,
  AccessManifestCheckpoint,
  ContainerAccessManifestState,
  DocumentLinkSetManifestState,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";

export function projectionReferencedPrincipalHeadRecord<
  PrincipalHead extends ReferencedPrincipalHead,
>(
  principalHead: PrincipalHead,
): Omit<ReferencedPrincipalHead, "principalType"> & {
  principalType: PrincipalHead["principalType"];
} {
  return {
    principalType: principalHead.principalType,
    principalId: principalHead.principalId,
    version: principalHead.version,
    keyEpoch: principalHead.keyEpoch,
    stateHash: principalHead.stateHash,
    keyFingerprint: principalHead.keyFingerprint,
  };
}

export function containerAccessManifestStateRecord(
  state: ContainerAccessManifestState,
) {
  return {
    version: state.version,
    containerId: state.containerId,
    organizationId: state.organizationId,
    epoch: state.epoch,
    previousManifestHash: state.previousManifestHash,
    eventHash: state.eventHash,
    parentContainerId: state.parentContainerId,
    parentManifestHash: state.parentManifestHash,
    metadataDocumentId: state.metadataDocumentId,
    containerKeyEpochId: state.containerKeyEpochId,
    directGrants: state.directGrants.map((grant) => ({
      accessLevel: grant.accessLevel,
      subjectId: grant.subjectId,
      subjectType: grant.subjectType,
    })),
    referencedPrincipalHeads: state.referencedPrincipalHeads.map(
      (principalHead) => ({
        principalType: principalHead.principalType,
        principalId: principalHead.principalId,
        version: principalHead.version,
        keyEpoch: principalHead.keyEpoch,
        stateHash: principalHead.stateHash,
        keyFingerprint: principalHead.keyFingerprint,
      }),
    ),
  };
}

export function documentLinkSetStateRecord(
  state: DocumentLinkSetManifestState,
) {
  return {
    version: state.version,
    documentId: state.documentId,
    organizationId: state.organizationId,
    epoch: state.epoch,
    previousManifestHash: state.previousManifestHash,
    eventHash: state.eventHash,
    linkedContainerIds: [...state.linkedContainerIds],
  };
}

export function accessManifestCheckpoint(input: {
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
}): AccessManifestCheckpoint {
  return {
    objectKind: input.manifest.objectKind,
    objectId: input.manifest.objectId,
    organizationId: input.manifest.organizationId,
    epoch: input.manifest.epoch,
    manifestHash: input.manifestHash,
  };
}
