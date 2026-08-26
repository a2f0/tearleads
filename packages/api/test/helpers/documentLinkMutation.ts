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
import type {
  AccessManifestBundleWire,
  DocumentLinkSetMutationRequest,
} from "@symcrypt/validators/request";
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
  readonly authorizingContainerPath?:
    | readonly AccessManifestBundleWire[]
    | undefined;
  readonly child: ContainerMutationResponse;
  readonly createdDocument: DocumentCreateResponse;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<DocumentLinkSetMutationRequest> {
  const childBundle = accessManifestFromContainerResponse(input.child);
  const childKek = kekStateFromContainerResponse(input.child);
  const previousState = input.createdDocument.accessManifest.state;
  const documentId = input.createdDocument.id;
  const authorizingContainerPath = input.authorizingContainerPath ?? [
    input.root.bundle,
  ];
  const body: DocumentLinkAccessEventBody = {
    eventType: "document.link",
    containerId: input.child.containerId,
    containerManifestHash: childBundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        [authorizingContainerPath.at(-1), childBundle]
          .filter((bundle): bundle is AccessManifestBundleWire => !!bundle)
          .map((bundle) => bundle.manifestHash),
      ),
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
      ...new Set([
        ...(Array.isArray(Reflect.get(previousState, "linkedContainerIds"))
          ? (Reflect.get(previousState, "linkedContainerIds") as string[])
          : []),
        input.child.containerId,
      ]),
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
      authorizingContainerPath.map((bundle) => ({
        containerId: asVerifiedContainerManifest(bundle).state.containerId,
        manifestHash: bundle.manifestHash,
      })),
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
  readonly remainingContainer?: StoredRootFixture | undefined;
  readonly remainingContainerPath?:
    | readonly AccessManifestBundleWire[]
    | undefined;
  readonly rotationBaselineSourceVersionVector?: string;
  readonly root: StoredRootFixture;
  readonly unlinkedContainer?: StoredRootFixture | undefined;
  readonly unlinkedContainerPath?:
    | readonly AccessManifestBundleWire[]
    | undefined;
}): Promise<DocumentLinkSetMutationRequest> {
  const childBundle = accessManifestFromContainerResponse(input.child);
  const childKek = kekStateFromContainerResponse(input.child);
  const childFixture: StoredRootFixture = {
    bundle: childBundle,
    kekState: childKek,
    principalPolicies: input.root.principalPolicies,
  };
  const unlinkedContainer = input.unlinkedContainer ?? childFixture;
  const unlinkedContainerPath = input.unlinkedContainerPath ?? [
    input.root.bundle,
    childBundle,
  ];
  const remainingContainer = input.remainingContainer ?? input.root;
  const remainingContainerPath = input.remainingContainerPath ?? [
    input.root.bundle,
  ];
  const previousState = input.linkedDocument.accessManifest.state;
  const documentId = input.linkedDocument.id;
  const body: DocumentAccessEventBody = {
    eventType: "document.unlink",
    containerId: unlinkedContainer.kekState.containerId,
    containerManifestHash: unlinkedContainer.bundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        [unlinkedContainerPath.at(-1), remainingContainerPath.at(-1)]
          .filter((bundle): bundle is AccessManifestBundleWire => !!bundle)
          .map((bundle) => bundle.manifestHash),
      ),
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
    linkedContainerIds: [remainingContainer.kekState.containerId],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const remainingTarget = {
    containerId: remainingContainer.kekState.containerId,
    containerManifestHash: remainingContainer.bundle.manifestHash,
    containerKeyEpochId: remainingContainer.kekState.containerKeyEpochId,
    containerKeyEpoch: remainingContainer.kekState.containerKeyEpoch,
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
    targetContainerPathRefs: unlinkedContainerPath.map((bundle) => ({
      containerId: asVerifiedContainerManifest(bundle).state.containerId,
      manifestHash: bundle.manifestHash,
    })),
    authorizingContainerPathRefs: [
      remainingContainerPath.map((bundle) => ({
        containerId: asVerifiedContainerManifest(bundle).state.containerId,
        manifestHash: bundle.manifestHash,
      })),
    ],
    contentKeyBundle: {
      contentKeyEpoch,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets: [
        {
          ...remainingTarget,
          wrappedKey: `document-key:${documentId}:rotated-${remainingTarget.containerId}`,
          wrappingMetadata: { alg: "test-wrap" },
        },
      ],
    },
    rotationBaseline,
  };
}
