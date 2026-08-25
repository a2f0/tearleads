import type { TestUser } from "@symcrypt/bob-and-alice";
import type {
  DocumentAccessEventBody,
  DocumentLinkAccessEventBody,
  DocumentLinkSetManifestState,
} from "@symcrypt/crypto";
import {
  computeAccessManifestHash,
  computeDocumentContentKeyTargetHash,
  deriveDocumentLinkSetManifest,
} from "@symcrypt/crypto";
import type { DocumentLinkSetMutationRequest } from "@symcrypt/validators/request";
import type {
  ContainerMutationResponse,
  DocumentCreateResponse,
  DocumentLinkSetMutationResponse,
} from "@symcrypt/validators/response";
import { createSignedAtomicRotationBaseline } from "./documentUpdateRequests";
import {
  accessManifestFromContainerResponse,
  asVerifiedContainerManifest,
  createSignedAccessEvent,
  kekStateFromContainerResponse,
  type StoredRootFixture,
} from "./keyingWriterProjectionKit";

export async function buildDocumentLinkRequest(input: {
  readonly child: ContainerMutationResponse;
  readonly createdDocument: DocumentCreateResponse;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<DocumentLinkSetMutationRequest> {
  const childBundle = accessManifestFromContainerResponse(input.child);
  const childKek = kekStateFromContainerResponse(input.child);
  const previousState = input.createdDocument.accessManifest.state;
  const documentId = input.createdDocument.id;
  const body: DocumentLinkAccessEventBody = {
    eventType: "document.link",
    containerId: input.child.containerId,
    containerManifestHash: childBundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [
      input.root.bundle.manifestHash,
      childBundle.manifestHash,
    ],
    objectId: documentId,
    objectKind: "document",
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    previousManifestHash: input.createdDocument.accessManifest.manifestHash,
    signer: input.owner,
  });
  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId,
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    epoch:
      typeof Reflect.get(previousState, "epoch") === "number"
        ? Number(Reflect.get(previousState, "epoch")) + 1
        : 2,
    previousManifestHash: input.createdDocument.accessManifest.manifestHash,
    eventHash: event.eventHash,
    linkedContainerIds: [
      input.root.kekState.containerId,
      input.child.containerId,
    ],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const targets = [
    ...input.createdDocument.documentKekTargets.targets.map((target) => ({
      containerId: String(Reflect.get(target, "containerId")),
      containerManifestHash: String(
        Reflect.get(target, "containerManifestHash"),
      ),
      containerKeyEpochId: String(Reflect.get(target, "containerKeyEpochId")),
      containerKeyEpoch: Number(Reflect.get(target, "containerKeyEpoch")),
    })),
    {
      containerId: input.child.containerId,
      containerManifestHash: childBundle.manifestHash,
      containerKeyEpochId: childKek.containerKeyEpochId,
      containerKeyEpoch: childKek.containerKeyEpoch,
    },
  ];
  const targetHash = await computeDocumentContentKeyTargetHash(targets);

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown as Record<string, unknown>,
    expectedManifestHash: manifestHash,
    manifest: manifest as unknown as Record<string, unknown>,
    targetContainerPathRefs: [
      {
        containerId: input.root.kekState.containerId,
        manifestHash: input.root.bundle.manifestHash,
      },
      {
        containerId: input.child.containerId,
        manifestHash: childBundle.manifestHash,
      },
    ],
    authorizingContainerPathRefs: [
      [
        {
          containerId: input.root.kekState.containerId,
          manifestHash: input.root.bundle.manifestHash,
        },
      ],
    ],
    contentKeyBundle: {
      contentKeyEpoch: input.createdDocument.contentKeyBundle.contentKeyEpoch,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets: [
        ...input.createdDocument.contentKeyBundle.targets,
        {
          containerId: input.child.containerId,
          containerManifestHash: childBundle.manifestHash,
          containerKeyEpochId: childKek.containerKeyEpochId,
          containerKeyEpoch: childKek.containerKeyEpoch,
          wrappedKey: `document-key:${documentId}:child`,
          wrappingMetadata: { alg: "test-wrap" },
        },
      ],
    },
  };
}

export async function buildDocumentUnlinkRequest(input: {
  readonly child: ContainerMutationResponse;
  readonly linkedDocument: DocumentLinkSetMutationResponse;
  readonly owner: TestUser;
  readonly rotationBaselineSourceVersionVector?: string;
  readonly root: StoredRootFixture;
}): Promise<DocumentLinkSetMutationRequest> {
  const childBundle = accessManifestFromContainerResponse(input.child);
  const previousState = input.linkedDocument.accessManifest.state;
  const documentId = input.linkedDocument.id;
  const body: DocumentAccessEventBody = {
    eventType: "document.unlink",
    containerId: input.child.containerId,
    containerManifestHash: childBundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [
      input.root.bundle.manifestHash,
      childBundle.manifestHash,
    ],
    objectId: documentId,
    objectKind: "document",
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    previousManifestHash: input.linkedDocument.accessManifest.manifestHash,
    signer: input.owner,
  });
  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId,
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    epoch:
      typeof Reflect.get(previousState, "epoch") === "number"
        ? Number(Reflect.get(previousState, "epoch")) + 1
        : 3,
    previousManifestHash: input.linkedDocument.accessManifest.manifestHash,
    eventHash: event.eventHash,
    linkedContainerIds: [input.root.kekState.containerId],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const remainingTarget = {
    containerId: input.root.kekState.containerId,
    containerManifestHash: input.root.bundle.manifestHash,
    containerKeyEpochId: input.root.kekState.containerKeyEpochId,
    containerKeyEpoch: input.root.kekState.containerKeyEpoch,
  };
  const targetHash = await computeDocumentContentKeyTargetHash([
    remainingTarget,
  ]);
  const contentKeyEpoch =
    input.linkedDocument.contentKeyBundle.contentKeyEpoch + 1;
  const rotationBaseline = await createSignedAtomicRotationBaseline({
    accessManifestHash: manifestHash,
    contentKeyEpoch,
    documentId,
    organizationId: state.organizationId,
    owner: input.owner,
    ...(input.rotationBaselineSourceVersionVector === undefined
      ? {}
      : {
          sourceVersionVector: input.rotationBaselineSourceVersionVector,
        }),
    targetHash,
  });

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown as Record<string, unknown>,
    expectedManifestHash: manifestHash,
    manifest: manifest as unknown as Record<string, unknown>,
    targetContainerPathRefs: [
      {
        containerId: input.root.kekState.containerId,
        manifestHash: input.root.bundle.manifestHash,
      },
      {
        containerId: input.child.containerId,
        manifestHash: childBundle.manifestHash,
      },
    ],
    authorizingContainerPathRefs: [
      [
        {
          containerId: input.root.kekState.containerId,
          manifestHash: input.root.bundle.manifestHash,
        },
      ],
    ],
    contentKeyBundle: {
      contentKeyEpoch,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets: [
        {
          ...remainingTarget,
          wrappedKey: `document-key:${documentId}:rotated-root`,
          wrappingMetadata: { alg: "test-wrap" },
        },
      ],
    },
    rotationBaseline,
  };
}
