import type {
  DocumentAccessEventBody,
  DocumentLinkAccessEventBody,
  DocumentLinkSetManifestState,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  computeDocumentContentKeyTargetHash,
  deriveDocumentLinkSetManifest,
} from "@tearleads/crypto";
import { emptyVersionVector, versionVectorsEqual } from "@tearleads/loro";
import type { TestUser } from "@tearleads/test-utils";
import type {
  AccessManifestBundleWire,
  DocumentLinkSetMutationRequest,
} from "@tearleads/validators/request";
import { contentKeyEnvelopeFixture } from "./contentKeyEnvelope";
import type {
  CreatedDocumentFixture,
  LinkedDocumentFixture,
} from "./documentAcknowledgementFixture";
import { CONTENT_KEY_COMMITMENT_FIXTURE } from "./documentEnvelopeFixture";
import { createSignedAtomicRotationBaseline } from "./documentUpdateRequests";
import {
  accessManifestFromContainerResponse,
  asVerifiedContainerManifest,
  createSignedAccessEvent,
  kekStateFromContainerResponse,
  type StoredRootFixture,
} from "./keyingWriterProjectionKit";
import { rememberRequestManifest } from "./requestManifests";
import type { StoredContainerMutation } from "./storedContainerMutation";

export async function buildDocumentLinkRequest(input: {
  readonly blobRewraps?: DocumentLinkAccessEventBody["blobRewraps"];
  readonly authorizingContainerPath?:
    | readonly AccessManifestBundleWire[]
    | undefined;
  readonly child: StoredContainerMutation;
  readonly createdDocument: CreatedDocumentFixture;
  readonly owner: TestUser;
  readonly root: StoredRootFixture;
}): Promise<DocumentLinkSetMutationRequest> {
  const childBundle = await accessManifestFromContainerResponse(input.child);
  const childKek = await kekStateFromContainerResponse(input.child);
  const previousState = input.createdDocument.accessManifest.state;
  const documentId = input.createdDocument.id;
  const authorizingContainerPath = input.authorizingContainerPath ?? [
    input.root.bundle,
  ];
  const body: DocumentLinkAccessEventBody = {
    blobRewraps: input.blobRewraps ?? [],
    eventType: "document.link",
    containerId: input.child.containerId,
    containerManifestHash: childBundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        [...authorizingContainerPath, input.root.bundle, childBundle].map(
          (bundle) => bundle.manifestHash,
        ),
      ),
    ],
    objectId: documentId,
    objectKind: "document",
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    previousManifestHash: input.createdDocument.manifestHash,
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
    previousManifestHash: input.createdDocument.manifestHash,
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

  return rememberRequestManifest(
    {
      event: event.event as unknown as Record<string, unknown>,
      body: body as unknown as Record<string, unknown>,
      expectedManifestHash: manifestHash,
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
        contentKeyCommitment:
          input.createdDocument.contentKeyBundle.contentKeyCommitment,
        contentKeyEpoch: input.createdDocument.contentKeyEpoch,
        linkSetManifestHash: manifestHash,
        targetHash,
        targets: [
          ...input.createdDocument.contentKeyBundle.targets,
          {
            containerId: input.child.containerId,
            containerManifestHash: childBundle.manifestHash,
            containerKeyEpochId: childKek.containerKeyEpochId,
            containerKeyEpoch: childKek.containerKeyEpoch,
            ...contentKeyEnvelopeFixture(
              "Document",
              `document-key:${documentId}:child`,
            ),
          },
        ],
      },
    },
    manifest,
  );
}

export async function buildDocumentUnlinkRequest(input: {
  readonly blobRewraps?: DocumentLinkAccessEventBody["blobRewraps"];
  readonly child: StoredContainerMutation;
  /** The rotated epoch's commitment; defaults to the fixture's. */
  readonly contentKeyCommitment?: string | undefined;
  readonly linkedDocument: LinkedDocumentFixture;
  readonly owner: TestUser;
  readonly remainingContainer?: StoredRootFixture | undefined;
  readonly remainingContainerPath?:
    | readonly AccessManifestBundleWire[]
    | undefined;
  /** The commitment the baseline's envelope declares, if not the epoch's. */
  readonly rotationBaselineContentKeyCommitment?: string | undefined;
  /** The rotation baseline's signed processed cursor. */
  readonly rotationBaselineCoversThroughUpdateId?: string | undefined;
  readonly rotationBaselineSourceVersionVector?: string;
  readonly root: StoredRootFixture;
  readonly unlinkedContainer?: StoredRootFixture | undefined;
  readonly unlinkedContainerPath?:
    | readonly AccessManifestBundleWire[]
    | undefined;
}): Promise<DocumentLinkSetMutationRequest> {
  const childBundle = await accessManifestFromContainerResponse(input.child);
  const childKek = await kekStateFromContainerResponse(input.child);
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
    blobRewraps: input.blobRewraps ?? [],
    eventType: "document.unlink",
    containerId: unlinkedContainer.kekState.containerId,
    containerManifestHash: unlinkedContainer.bundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        [...unlinkedContainerPath, ...remainingContainerPath].map(
          (bundle) => bundle.manifestHash,
        ),
      ),
    ],
    objectId: documentId,
    objectKind: "document",
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    previousManifestHash: input.linkedDocument.manifestHash,
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
    previousManifestHash: input.linkedDocument.manifestHash,
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
  const contentKeyEpoch = input.linkedDocument.contentKeyEpoch + 1;
  const contentKeyCommitment =
    input.contentKeyCommitment ?? CONTENT_KEY_COMMITMENT_FIXTURE;
  const rotationBaseline = await createSignedAtomicRotationBaseline({
    dependencyManifestHashes: remainingContainerPath.map(
      (bundle) => bundle.manifestHash,
    ),
    accessManifestHash: manifestHash,
    contentKeyCommitment:
      input.rotationBaselineContentKeyCommitment ?? contentKeyCommitment,
    contentKeyEpoch,
    coversThroughUpdateId: input.rotationBaselineCoversThroughUpdateId,
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

  return rememberRequestManifest(
    {
      event: event.event as unknown as Record<string, unknown>,
      body: body as unknown as Record<string, unknown>,
      expectedManifestHash: manifestHash,
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
        contentKeyCommitment,
        contentKeyEpoch,
        linkSetManifestHash: manifestHash,
        targetHash,
        targets: [
          {
            ...remainingTarget,
            ...contentKeyEnvelopeFixture(
              "Document",
              `document-key:${documentId}:rotated-${remainingTarget.containerId}`,
            ),
          },
        ],
      },
      // A document with no committed history has nothing for a baseline to
      // cover: the SDK unlinks it without one, as the API requires. An empty
      // snapshot that signs a processed cursor is still sent.
      ...(versionVectorsEqual(
        rotationBaseline.partialEndVersionVector,
        emptyVersionVector(),
      ) && input.rotationBaselineCoversThroughUpdateId === undefined
        ? {}
        : { rotationBaseline }),
    },
    manifest,
  );
}
