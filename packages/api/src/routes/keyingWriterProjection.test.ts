import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestDocumentLinkProjection,
  accessManifests,
  containerDocumentSyncTombstones,
  containerKeyEpochs,
  containers,
  documentAuditCheckpoints,
  documentAuditEntries,
  documentContainerLinks,
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documents,
  documentUpdateAuditEvents,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type {
  ContainerAccessEventBody,
  DocumentAccessEventBody,
  DocumentLinkAccessEventBody,
  DocumentLinkSetManifestState,
  KeyingCanonicalJson,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  computeContainerKekPredecessorBridgeHash,
  computeDocumentContentKeyTargetHash,
  deriveDocumentLinkSetManifest,
} from "@tearleads/crypto";
import { emptyVersionVector } from "@tearleads/loro";
import type {
  AccessManifestBundleWire,
  ContainerManifestRef,
  ContainerMutationRequest,
  DocumentLinkSetMutationRequest,
  DocumentSyncRequest,
} from "@tearleads/validators/request";
import {
  type ContainerMutationResponse,
  type DocumentLinkSetMutationResponse,
  type DocumentWriterProjectionResponse,
  isContainerMutationResponse,
  isContainerWriterProjectionResponse,
  isDocumentCreateResponse,
  isDocumentLinkSetMutationResponse,
  isDocumentSyncResponse,
  isDocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { and, eq, inArray } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../test/helpers/authenticate";
import {
  createTestContainerKekMaterial,
  createTestContainerKekPredecessorBridge,
} from "../../test/helpers/containerKekMaterial";
import {
  appendUnexpectedUserWrapToRekey,
  buildRootContainerRekeyMutation,
} from "../../test/helpers/containerRekey";
import {
  createSignedAtomicRotationBaseline,
  createSignedDocumentSyncRequest,
  expectStaleAtomicUnlinkRollsBack,
} from "../../test/helpers/documentUpdateRequests";
import {
  accessManifestFromContainerResponse,
  asVerifiedContainerManifest,
  bootstrapRoot,
  buildRootGrantRequest,
  buildRootRevokeRequest,
  createContainerKeyEpoch,
  createContainerKeyWrap,
  createContainerManifestBundle,
  createDocument,
  createDocumentRequest,
  createSignedAccessEvent,
  kekStateFromContainerResponse,
  loadPrincipalPoliciesForContainerPath,
  type StoredRootFixture,
  uniquePrincipalPolicies,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { getCurrentContainerKeyEpoch } from "../access/read/containerKekStore";
import { verifyDocumentAuditHistory } from "../documents/verifyDocumentAuditHistory";
import { routeApp } from "../routeApp";

async function loadPrincipalPoliciesForContainerPaths(
  paths: readonly (readonly AccessManifestBundleWire[])[],
): Promise<VerifiedPrincipalPolicy[]> {
  const principalPolicySets = await Promise.all(
    paths.map((path) => loadPrincipalPoliciesForContainerPath(path)),
  );

  return uniquePrincipalPolicies(principalPolicySets.flat());
}

async function createChildContainer(input: {
  readonly parent: StoredRootFixture;
  readonly signer: TestUser;
}): Promise<ContainerMutationResponse> {
  const containerId = crypto.randomUUID();
  const { containerKeyEpochId } = await createTestContainerKekMaterial({
    containerId,
    keyEpoch: 1,
  });
  const parentManifest = asVerifiedContainerManifest(input.parent.bundle);
  const body: ContainerAccessEventBody = {
    eventType: "container.create",
    parentContainerId: parentManifest.state.containerId,
    parentManifestHash: input.parent.bundle.manifestHash,
    metadataDocumentId: crypto.randomUUID(),
    containerKeyEpochId,
    directGrants: [],
    referencedPrincipalHeads: [],
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [input.parent.bundle.manifestHash],
    objectId: containerId,
    objectKind: "container",
    organizationId: parentManifest.state.organizationId,
    previousManifestHash: null,
    signer: input.signer,
  });
  const bundle = await createContainerManifestBundle(
    {
      version: 1,
      containerId,
      organizationId: parentManifest.state.organizationId,
      epoch: 1,
      previousManifestHash: null,
      eventHash: event.eventHash,
      parentContainerId: parentManifest.state.containerId,
      parentManifestHash: input.parent.bundle.manifestHash,
      metadataDocumentId: body.metadataDocumentId,
      containerKeyEpochId,
      directGrants: [],
      referencedPrincipalHeads: [],
    },
    event,
  );
  const keyEpoch = createContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: 1,
    manifest: bundle,
    parentKekState: input.parent.kekState,
  });
  const wrap = createContainerKeyWrap({
    containerKeyEpochId,
    parentKekState: input.parent.kekState,
    wrapManifestHash: bundle.manifestHash,
  });
  const principalPolicies = await loadPrincipalPoliciesForContainerPath([
    input.parent.bundle,
  ]);
  const request: ContainerMutationRequest = {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    parentContainerPath: [input.parent.bundle],
    principalPolicies: principalPolicies as unknown as Record<
      string,
      unknown
    >[],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    predecessorBridge: null,
    wraps: [wrap as unknown as Record<string, unknown>],
    parentKekState: input.parent.kekState as unknown as Record<string, unknown>,
    userRecipientKeys: [],
  };
  const response = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.signer.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(response.status).toBe(200);
  const created = await response.json();
  expect(isContainerMutationResponse(created)).toBe(true);
  return created as ContainerMutationResponse;
}

async function buildContainerMoveRequest(input: {
  readonly destinationParent: AccessManifestBundleWire;
  readonly destinationParentKekState: VerifiedContainerKekState;
  readonly destinationParentPath: readonly AccessManifestBundleWire[];
  readonly previous: AccessManifestBundleWire;
  readonly previousContainerPath: readonly AccessManifestBundleWire[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly signer: TestUser;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.previous);
  const destinationParent = asVerifiedContainerManifest(
    input.destinationParent,
  );
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths([
    input.previousContainerPath,
    input.destinationParentPath,
  ]);
  const nextKeyEpoch = input.previousKekState.containerKeyEpoch + 1;
  const { containerKeyEpochId } = await createTestContainerKekMaterial({
    containerId: previous.state.containerId,
    keyEpoch: nextKeyEpoch,
  });
  const predecessorBridge = await createTestContainerKekPredecessorBridge({
    containerId: previous.state.containerId,
    predecessorContainerKeyEpochId: input.previousKekState.containerKeyEpochId,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  const body: ContainerAccessEventBody = {
    eventType: "container.move",
    parentContainerId: destinationParent.state.containerId,
    parentManifestHash: input.destinationParent.manifestHash,
    containerKeyEpochId,
    predecessorBridgeHash:
      await computeContainerKekPredecessorBridgeHash(predecessorBridge),
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(
        [...input.previousContainerPath, ...input.destinationParentPath].map(
          (manifest) => manifest.manifestHash,
        ),
      ),
    ],
    objectId: previous.state.containerId,
    objectKind: "container",
    organizationId: previous.state.organizationId,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer,
  });
  const bundle = await createContainerManifestBundle(
    {
      ...previous.state,
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.previous.manifestHash,
      eventHash: event.eventHash,
      parentContainerId: destinationParent.state.containerId,
      parentManifestHash: input.destinationParent.manifestHash,
      containerKeyEpochId,
    },
    event,
  );
  const keyEpoch = createContainerKeyEpoch({
    containerKeyEpochId,
    keyEpoch: nextKeyEpoch,
    manifest: bundle,
    parentKekState: input.destinationParentKekState,
  });
  const wrap = createContainerKeyWrap({
    containerKeyEpochId,
    parentKekState: input.destinationParentKekState,
    wrapManifestHash: bundle.manifestHash,
  });
  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.previous,
    previousContainerPath: [...input.previousContainerPath],
    destinationParentContainerPath: [...input.destinationParentPath],
    principalPolicies: principalPolicies as unknown as Record<
      string,
      unknown
    >[],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    predecessorBridge: predecessorBridge as unknown as Record<string, unknown>,
    wraps: [wrap as unknown as Record<string, unknown>],
    parentKekState: input.destinationParentKekState as unknown as Record<
      string,
      unknown
    >,
    userRecipientKeys: [],
  };
}

async function moveContainer(input: {
  readonly destinationParent: AccessManifestBundleWire;
  readonly destinationParentKekState: VerifiedContainerKekState;
  readonly destinationParentPath: readonly AccessManifestBundleWire[];
  readonly previous: AccessManifestBundleWire;
  readonly previousContainerPath: readonly AccessManifestBundleWire[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly signer: TestUser;
}): Promise<ContainerMutationResponse> {
  const previous = asVerifiedContainerManifest(input.previous);
  const response = await routeApp.request(
    `/containers/${previous.state.containerId}/move`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.signer.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(await buildContainerMoveRequest(input)),
    },
  );

  expect(response.status).toBe(200);
  const moved = await response.json();
  expect(isContainerMutationResponse(moved)).toBe(true);
  return moved as ContainerMutationResponse;
}

async function countDocumentAuditRows(documentId: string, updateId: string) {
  const [auditEntries, updateEvents, checkpoints] = await Promise.all([
    db
      .select({
        entryHash: documentAuditEntries.entryHash,
        id: documentAuditEntries.id,
      })
      .from(documentAuditEntries)
      .where(eq(documentAuditEntries.documentId, documentId)),
    db
      .select({ liveUpdateId: documentUpdateAuditEvents.liveUpdateId })
      .from(documentUpdateAuditEvents)
      .where(eq(documentUpdateAuditEvents.liveUpdateId, updateId)),
    db
      .select({
        baselineUpdateId: documentAuditCheckpoints.baselineUpdateId,
        coveredAuditEntryHash: documentAuditCheckpoints.coveredAuditEntryHash,
      })
      .from(documentAuditCheckpoints)
      .where(eq(documentAuditCheckpoints.baselineUpdateId, updateId)),
  ]);

  return { auditEntries, checkpoints, updateEvents };
}

test("POST /documents rejects malformed signed event records", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await createDocumentRequest({ owner, root });

  request.event = {
    ...request.event,
    version: "2",
  };

  const response = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "Document event.version is invalid",
  });
});

test("POST /documents applies optional container rekeys before target validation", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const rootRekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const request = await createDocumentRequest({
    owner,
    root: {
      bundle: rootRekey.bundle,
      kekState: rootRekey.kekState,
      principalPolicies: root.principalPolicies,
    },
  });
  request.containerRekeys = [rootRekey.request];

  const response = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(response.status).toBe(200);
  const created = await response.json();
  expect(isDocumentCreateResponse(created)).toBe(true);
  expect(created.documentKekTargets.linkedContainerKeyEpochIds).toEqual([
    rootRekey.kekState.containerKeyEpochId,
  ]);

  const currentRootEpoch = await getCurrentContainerKeyEpoch(
    root.kekState.containerId,
    db,
  );
  expect(currentRootEpoch?.id).toBe(rootRekey.kekState.containerKeyEpochId);

  const projectionResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(projectionResponse.status).toBe(200);
  const projection = await projectionResponse.json();
  expect(isContainerWriterProjectionResponse(projection)).toBe(true);
  expect(
    projection.containerKeks[0]?.containerManifestHistory?.map(
      (entry: { manifestHash: string }) => entry.manifestHash,
    ),
  ).toEqual([root.bundle.manifestHash]);
});

async function buildDocumentLinkRequest(input: {
  readonly child: ContainerMutationResponse;
  readonly createdDocument: Awaited<ReturnType<typeof createDocument>>;
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

async function buildDocumentUnlinkRequest(input: {
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

test("GET /containers/:containerId/writer-projection returns signed path and KEK projection", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(isContainerWriterProjectionResponse(body)).toBe(true);
  expect(body.containerId).toBe(root.kekState.containerId);
  expect(
    body.path.map((entry: { manifestHash: string }) => entry.manifestHash),
  ).toEqual([root.bundle.manifestHash]);
  expect(body.path[0].event.eventHash).toBe(
    asVerifiedContainerManifest(root.bundle).event.eventHash,
  );
  expect(body.path[0].event.body.eventType).toBe("container.create");
  expect(body.containerKeks).toHaveLength(1);
  expect(body.containerKeks[0].containerKeyEpochId).toBe(
    root.kekState.containerKeyEpochId,
  );
});

test("GET /containers/:containerId/writer-projection verifies inherited parent KEK edges", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });

  const response = await routeApp.request(
    `/containers/${child.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(isContainerWriterProjectionResponse(body)).toBe(true);
  expect(
    body.path.map((entry: { manifestHash: string }) => entry.manifestHash),
  ).toEqual([root.bundle.manifestHash, child.accessManifest.manifestHash]);
  expect(body.containerKeks).toHaveLength(2);
  expect(body.containerKeks[1].parentContainerKeyEpochId).toBe(
    root.kekState.containerKeyEpochId,
  );
});

test("GET /containers/:containerId/writer-projection includes historical parent proofs after moving back to root", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const parentA = await createChildContainer({ parent: root, signer: owner });
  const movedChild = await createChildContainer({
    parent: root,
    signer: owner,
  });
  const parentABundle = accessManifestFromContainerResponse(parentA);
  const parentAKek = kekStateFromContainerResponse(parentA);
  const movedChildCreateBundle =
    accessManifestFromContainerResponse(movedChild);
  const movedUnderParentA = await moveContainer({
    destinationParent: parentABundle,
    destinationParentKekState: parentAKek,
    destinationParentPath: [root.bundle, parentABundle],
    previous: movedChildCreateBundle,
    previousContainerPath: [root.bundle, movedChildCreateBundle],
    previousKekState: kekStateFromContainerResponse(movedChild),
    signer: owner,
  });
  const movedUnderParentABundle =
    accessManifestFromContainerResponse(movedUnderParentA);
  const movedBackToRoot = await moveContainer({
    destinationParent: root.bundle,
    destinationParentKekState: root.kekState,
    destinationParentPath: [root.bundle],
    previous: movedUnderParentABundle,
    previousContainerPath: [
      root.bundle,
      parentABundle,
      movedUnderParentABundle,
    ],
    previousKekState: kekStateFromContainerResponse(movedUnderParentA),
    signer: owner,
  });

  const response = await routeApp.request(
    `/containers/${movedChild.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(isContainerWriterProjectionResponse(body)).toBe(true);
  expect(
    body.path.map((entry: { manifestHash: string }) => entry.manifestHash),
  ).toEqual([
    root.bundle.manifestHash,
    accessManifestFromContainerResponse(movedBackToRoot).manifestHash,
  ]);

  const movedChildHistoryHashes =
    body.containerKeks[1]?.containerManifestHistory?.map(
      (entry: { manifestHash: string }) => entry.manifestHash,
    ) ?? [];
  expect(movedChildHistoryHashes).toContain(
    movedUnderParentABundle.manifestHash,
  );
  expect(movedChildHistoryHashes).toContain(
    movedChildCreateBundle.manifestHash,
  );
  expect(movedChildHistoryHashes).toContain(parentABundle.manifestHash);
});

test("GET /containers/:containerId/writer-projection rejects users without write access", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(outsider);
  await authenticate(outsider);
  const root = await bootstrapRoot(owner);

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${outsider.token}`,
      },
    },
  );

  expect(response.status).toBe(403);
});

test("GET /containers/:containerId/writer-projection rejects malformed stored state", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);

  await db
    .update(accessManifests)
    .set({
      state: {
        ...root.bundle.state,
        version: 2,
      } as KeyingCanonicalJson,
    })
    .where(eq(accessManifests.manifestHash, root.bundle.manifestHash));

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(409);
});

test("GET /containers/:containerId/writer-projection rejects tampered stored KEK state", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);

  await db
    .update(containerKeyEpochs)
    .set({
      accessManifestHash: "0".repeat(64),
    })
    .where(eq(containerKeyEpochs.id, root.kekState.containerKeyEpochId));

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(409);
});

test("GET /documents/:documentId/writer-projection returns document targets and authorizing paths", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(200);
  const projection = await projectionResponse.json();
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);
  expect(projection.documentId).toBe(created.id);
  expect(projection.documentManifest.manifestHash).toBe(
    created.accessManifest.manifestHash,
  );
  expect(projection.documentManifest.event.eventHash).toBe(
    Reflect.get(created.accessManifest.event, "eventHash"),
  );
  expect(projection.documentManifest.event.body.eventType).toBe(
    "document.link",
  );
  expect(projection.documentKekTargets.documentKeyTargetHash).toBe(
    created.documentKekTargets.documentKeyTargetHash,
  );
  expect(projection.contentKeyBundle.targetHash).toBe(
    created.contentKeyBundle.targetHash,
  );
  expect(projection.authorizingContainerPaths).toHaveLength(1);
});

test("read-only document sync works for a user with read access to a linked container", async () => {
  const owner = createTestUser();
  const recipient = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(recipient);
  await authenticate(recipient);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request, updateId } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });

  const writeResponse = await routeApp.request(
    `/documents/${created.id}/sync`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  expect(writeResponse.status).toBe(200);

  const grantRequest = await buildRootGrantRequest({
    accessLevel: "read",
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient,
    signer: owner,
  });
  const shareResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(grantRequest),
    },
  );
  expect(shareResponse.status).toBe(200);

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${recipient.token}`,
      },
    },
  );
  expect(projectionResponse.status).toBe(200);
  const projection = await projectionResponse.json();
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);

  const syncResponse = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recipient.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentKeyEpoch: projection.contentKeyBundle.contentKeyEpoch,
      expectedLinkSetManifestHash:
        projection.contentKeyBundle.linkSetManifestHash,
      expectedTargetHash: projection.contentKeyBundle.targetHash,
      localVersionVector: null,
      outgoingUpdates: [],
    } satisfies DocumentSyncRequest),
  });

  expect(syncResponse.status).toBe(200);
  const synced = await syncResponse.json();
  expect(isDocumentSyncResponse(synced)).toBe(true);
  expect(synced.updates.map((update: { id: string }) => update.id)).toContain(
    updateId,
  );

  const stateChangingReadSyncResponse = await routeApp.request(
    `/documents/${created.id}/sync`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${recipient.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contentKeyBundle: projection.contentKeyBundle,
        contentKeyEpoch: projection.contentKeyBundle.contentKeyEpoch,
        expectedLinkSetManifestHash:
          projection.contentKeyBundle.linkSetManifestHash,
        expectedTargetHash: projection.contentKeyBundle.targetHash,
        localVersionVector: null,
        outgoingUpdates: [],
      } satisfies DocumentSyncRequest),
    },
  );
  expect(stateChangingReadSyncResponse.status).toBe(400);
}, 10_000);

test("GET /documents/:documentId/writer-projection blocks revoked users after root KEK rotation", async () => {
  const owner = createTestUser();
  const recipient = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(recipient);
  await authenticate(recipient);
  const root = await bootstrapRoot(owner);
  const grantRequest = await buildRootGrantRequest({
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient,
    signer: owner,
  });

  const shareResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(grantRequest),
    },
  );
  expect(shareResponse.status).toBe(200);
  const shared = await shareResponse.json();
  expect(isContainerMutationResponse(shared)).toBe(true);

  const recipientSharedProjectionResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${recipient.token}`,
      },
    },
  );
  expect(recipientSharedProjectionResponse.status).toBe(200);

  const revokeRequest = await buildRootRevokeRequest({
    previous: accessManifestFromContainerResponse(shared),
    previousKekState: kekStateFromContainerResponse(shared),
    revokedUser: recipient,
    signer: owner,
  });
  const revokeResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/revoke`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(revokeRequest),
    },
  );
  expect(revokeResponse.status).toBe(200);
  const revoked = await revokeResponse.json();
  expect(isContainerMutationResponse(revoked)).toBe(true);
  expect(revoked.containerKek.containerKeyEpochId).not.toBe(
    shared.containerKek.containerKeyEpochId,
  );

  const created = await createDocument({
    owner,
    root: {
      bundle: accessManifestFromContainerResponse(revoked),
      kekState: kekStateFromContainerResponse(revoked),
      principalPolicies: root.principalPolicies,
    },
  });
  expect(created.documentKekTargets.linkedContainerKeyEpochIds).toEqual([
    revoked.containerKek.containerKeyEpochId,
  ]);
  expect(created.documentKekTargets.targets).toEqual([
    expect.objectContaining({
      containerId: root.kekState.containerId,
      containerKeyEpoch: revoked.containerKek.containerKeyEpoch,
      containerKeyEpochId: revoked.containerKek.containerKeyEpochId,
    }),
  ]);

  const ownerProjectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );
  expect(ownerProjectionResponse.status).toBe(200);
  const ownerProjection = await ownerProjectionResponse.json();
  expect(isDocumentWriterProjectionResponse(ownerProjection)).toBe(true);
  expect(ownerProjection.contentKeyBundle.targets).toEqual([
    expect.objectContaining({
      containerId: root.kekState.containerId,
      containerKeyEpochId: revoked.containerKek.containerKeyEpochId,
    }),
  ]);

  const recipientProjectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${recipient.token}`,
      },
    },
  );
  expect(recipientProjectionResponse.status).toBe(403);
}, 10_000);

test("POST /documents/:documentId/sync writes audit rows for accepted live updates", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request, updateId } = await createSignedDocumentSyncRequest({
    checkpoint: true,
    created,
    owner,
    root,
  });
  const preSyncUpdatedAt = new Date("2026-05-05T00:00:00.000Z");
  await Promise.all([
    db
      .update(documents)
      .set({ updatedAt: preSyncUpdatedAt })
      .where(eq(documents.id, created.id)),
    db
      .update(containers)
      .set({ updatedAt: preSyncUpdatedAt })
      .where(eq(containers.id, root.kekState.containerId)),
  ]);

  const syncResponse = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  expect(syncResponse.status).toBe(200);
  const synced = await syncResponse.json();
  expect(isDocumentSyncResponse(synced)).toBe(true);
  expect(synced.acceptedOutgoingUpdateIds).toEqual([updateId]);
  const [[syncedDocumentRow], [syncedContainerRow]] = await Promise.all([
    db
      .select({ updatedAt: documents.updatedAt })
      .from(documents)
      .where(eq(documents.id, created.id))
      .limit(1),
    db
      .select({ updatedAt: containers.updatedAt })
      .from(containers)
      .where(eq(containers.id, root.kekState.containerId))
      .limit(1),
  ]);
  invariant(syncedDocumentRow, "expected synced document row");
  invariant(syncedContainerRow, "expected synced container row");
  expect(syncedDocumentRow.updatedAt.toISOString()).not.toBe(
    preSyncUpdatedAt.toISOString(),
  );
  expect(syncedContainerRow.updatedAt.toISOString()).toBe(
    syncedDocumentRow.updatedAt.toISOString(),
  );

  const retryResponse = await routeApp.request(
    `/documents/${created.id}/sync`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  expect(retryResponse.status).toBe(200);
  const retried = await retryResponse.json();
  expect(isDocumentSyncResponse(retried)).toBe(true);
  expect(retried.acceptedOutgoingUpdateIds).toEqual([updateId]);

  const { auditEntries, checkpoints, updateEvents } =
    await countDocumentAuditRows(created.id, updateId);
  expect(auditEntries).toHaveLength(1);
  expect(updateEvents).toEqual([{ liveUpdateId: updateId }]);
  expect(checkpoints).toHaveLength(1);
  expect(checkpoints[0]?.coveredAuditEntryHash).toBe(
    auditEntries[0]?.entryHash,
  );

  const auditHistory = await verifyDocumentAuditHistory(db, {
    documentId: created.id,
  });
  expect(auditHistory).toMatchObject({
    attachmentEventCount: 0,
    auditEntryCount: 1,
    checkpointCount: 1,
    isValid: true,
    updateEventCount: 1,
  });
});

function rootAuthorizingPathRef(root: StoredRootFixture): ContainerManifestRef {
  return {
    containerId: root.kekState.containerId,
    manifestHash: root.bundle.manifestHash,
  };
}

async function postDocumentSync(
  documentId: string,
  owner: TestUser,
  request: DocumentSyncRequest,
): Promise<Response> {
  return routeApp.request(`/documents/${documentId}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

test("POST /documents/:documentId/sync emits the coded document_not_found 404 only for a positively-absent document", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });

  const response = await postDocumentSync(crypto.randomUUID(), owner, request);

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    code: "document_not_found",
    error: "Document not found",
  });
});

test("GET /documents/:documentId/writer-projection emits the coded document_not_found 404 for an unknown document", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const response = await routeApp.request(
    `/documents/${crypto.randomUUID()}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    code: "document_not_found",
    error: "Document not found",
  });
});

test("POST /documents/:documentId/sync rejects an unknown authorizing path ref with 409, never the wipe-signal 404", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });

  const response = await postDocumentSync(created.id, owner, {
    ...request,
    authorizingContainerPathRefs: [
      [
        {
          containerId: root.kekState.containerId,
          manifestHash: "f".repeat(64),
        },
      ],
    ],
  });
  expect(response.status).toBe(409);
});

test("POST /documents/:documentId/sync rejects an authorizing path ref whose containerId does not match the resolved manifest with 400", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });

  // A real, current manifestHash for the root, but a foreign containerId. The
  // server keys the head lookup off the resolved manifest's own containerId and
  // must reject the mismatch rather than authorize against the wrong container.
  const response = await postDocumentSync(created.id, owner, {
    ...request,
    authorizingContainerPathRefs: [
      [
        {
          containerId: crypto.randomUUID(),
          manifestHash: root.bundle.manifestHash,
        },
      ],
    ],
  });
  expect(response.status).toBe(400);
});

test("POST /documents/:documentId/sync rejects a stale authorizing path ref after the container head advances with 409", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  // Advance the root container's head past root.bundle.manifestHash. The old
  // manifest stays stored (resolvable by hash) but is no longer the head, so a
  // ref to it must be rejected as stale — without this pin a writer could replay
  // a manifest from an epoch where they held since-revoked access.
  const rootRekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const rekeyDocument = await createDocumentRequest({
    owner,
    root: {
      bundle: rootRekey.bundle,
      kekState: rootRekey.kekState,
      principalPolicies: root.principalPolicies,
    },
  });
  rekeyDocument.containerRekeys = [rootRekey.request];
  const rekeyResponse = await routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(rekeyDocument),
  });
  expect(rekeyResponse.status).toBe(200);

  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  // The request's refs point at the now-stale pre-rekey root manifest hash.
  const response = await postDocumentSync(created.id, owner, {
    ...request,
    authorizingContainerPathRefs: [[rootAuthorizingPathRef(root)]],
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: "document_sync_state_stale",
  });
});

test("POST /documents/:documentId/sync rejects a stale expectedLinkSetManifestHash with 409", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });

  // The server resolves the document's link-set manifest from its own store and
  // pins it to the current head; a stale/forged expected hash (not the current
  // head) must be rejected rather than authorizing against a different link-set.
  const response = await postDocumentSync(created.id, owner, {
    ...request,
    expectedLinkSetManifestHash: "f".repeat(64),
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: "document_sync_state_stale",
  });
});

test("POST /documents/:documentId/sync redirects historical updates to the atomic rotation baseline", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const created = await createDocument({ owner, root });
  const { request, updateId } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });

  const writeResponse = await routeApp.request(
    `/documents/${created.id}/sync`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );
  expect(writeResponse.status).toBe(200);

  const linkRequest = await buildDocumentLinkRequest({
    child,
    createdDocument: created,
    owner,
    root,
  });
  const linkResponse = await routeApp.request(`/documents/${created.id}/link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(linkRequest),
  });
  expect(linkResponse.status).toBe(200);
  const linkedDocument = await linkResponse.json();
  expect(isDocumentLinkSetMutationResponse(linkedDocument)).toBe(true);

  const unlinkRequest = await buildDocumentUnlinkRequest({
    child,
    linkedDocument,
    owner,
    root,
  });
  const unlinkResponse = await routeApp.request(
    `/documents/${created.id}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(unlinkRequest),
    },
  );
  expect(unlinkResponse.status).toBe(200);
  const unlinkedDocument = await unlinkResponse.json();
  expect(isDocumentLinkSetMutationResponse(unlinkedDocument)).toBe(true);

  const syncResponse = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contentKeyEpoch: unlinkedDocument.contentKeyBundle.contentKeyEpoch,
      expectedLinkSetManifestHash:
        unlinkedDocument.contentKeyBundle.linkSetManifestHash,
      expectedTargetHash: unlinkedDocument.contentKeyBundle.targetHash,
      localVersionVector: null,
      outgoingUpdates: [],
    } satisfies DocumentSyncRequest),
  });

  expect(syncResponse.status).toBe(200);
  const synced = await syncResponse.json();
  expect(isDocumentSyncResponse(synced)).toBe(true);
  expect(synced.updates.map((update: { id: string }) => update.id)).toEqual([
    unlinkRequest.rotationBaseline?.id,
  ]);
  expect(
    synced.updates.map((update: { id: string }) => update.id),
  ).not.toContain(updateId);
  expect(
    synced.contentKeyBundles
      .map((bundle: { contentKeyEpoch: number }) => bundle.contentKeyEpoch)
      .sort((left: number, right: number) => left - right),
  ).toEqual([unlinkedDocument.contentKeyBundle.contentKeyEpoch]);
});

test("POST /documents/:documentId/sync rolls back optional rekeys when write validation fails", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  request.containerRekeys = [rekey.request];

  const syncResponse = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(syncResponse.status).toBe(409);
  const currentRootEpoch = await getCurrentContainerKeyEpoch(
    root.kekState.containerId,
    db,
  );
  expect(currentRootEpoch?.id).toBe(root.kekState.containerKeyEpochId);
});

test("POST /documents/:documentId/sync rejects invalid optional container rekeys", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  appendUnexpectedUserWrapToRekey(rekey.request);
  const { request } = await createSignedDocumentSyncRequest({
    created,
    owner,
    root,
  });
  request.containerRekeys = [rekey.request];

  const syncResponse = await routeApp.request(`/documents/${created.id}/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  expect(syncResponse.status).toBe(409);
  expect(await syncResponse.json()).toEqual({
    code: "document_sync_conflict",
    error: "container key wrap is not justified by its manifest",
  });
  const currentRootEpoch = await getCurrentContainerKeyEpoch(
    root.kekState.containerId,
    db,
  );
  expect(currentRootEpoch?.id).toBe(root.kekState.containerKeyEpochId);
});

test("GET /documents/:documentId/writer-projection refreshes same-epoch root share targets", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const recipient = createTestUser();
  await registerUser(recipient);
  await authenticate(recipient);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const shareRequest = await buildRootGrantRequest({
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient,
    signer: owner,
  });
  const shareResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(shareRequest),
    },
  );

  expect(shareResponse.status).toBe(200);
  const shared = await shareResponse.json();
  expect(isContainerMutationResponse(shared)).toBe(true);
  const [storedBundleBeforeProjection] = await db
    .select({
      linkSetManifestHash: documentContentKeyEpochs.linkSetManifestHash,
      targetHash: documentContentKeyEpochs.targetHash,
    })
    .from(documentContentKeyEpochs)
    .where(
      and(
        eq(documentContentKeyEpochs.documentId, created.id),
        eq(
          documentContentKeyEpochs.contentKeyEpoch,
          created.contentKeyBundle.contentKeyEpoch,
        ),
      ),
    )
    .limit(1);
  invariant(storedBundleBeforeProjection, "expected content-key bundle row");
  expect(storedBundleBeforeProjection.targetHash).toBe(
    created.contentKeyBundle.targetHash,
  );

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${recipient.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(200);
  const projection = await projectionResponse.json();
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);
  expect(projection.contentKeyBundle.contentKeyEpoch).toBe(
    created.contentKeyBundle.contentKeyEpoch,
  );
  expect(projection.documentKekTargets.documentKeyTargetHash).toBe(
    projection.contentKeyBundle.targetHash,
  );
  expect(projection.contentKeyBundle.targetHash).not.toBe(
    storedBundleBeforeProjection.targetHash,
  );
  expect(projection.documentKekTargets.linkedContainerManifestHashes).toEqual([
    shared.manifestHead.manifestHash,
  ]);
  expect(projection.contentKeyBundle.targets).toEqual([
    {
      ...created.contentKeyBundle.targets[0],
      containerManifestHash: shared.manifestHead.manifestHash,
    },
  ]);
  expect(projection.authorizingContainerPaths).toHaveLength(1);
  expect(
    projection.authorizingContainerPaths[0]?.containerKeks[0]?.containerManifestHistory?.map(
      (entry: { manifestHash: string }) => entry.manifestHash,
    ),
  ).toEqual([root.bundle.manifestHash]);

  const [storedBundleAfterProjection] = await db
    .select({
      linkSetManifestHash: documentContentKeyEpochs.linkSetManifestHash,
      targetHash: documentContentKeyEpochs.targetHash,
    })
    .from(documentContentKeyEpochs)
    .where(
      and(
        eq(documentContentKeyEpochs.documentId, created.id),
        eq(
          documentContentKeyEpochs.contentKeyEpoch,
          created.contentKeyBundle.contentKeyEpoch,
        ),
      ),
    )
    .limit(1);
  expect(storedBundleAfterProjection).toEqual(storedBundleBeforeProjection);
}, 10_000);

test("GET /documents/:documentId/writer-projection rejects tampered content-key targets", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const [contentKeyEpoch] = await db
    .select({ id: documentContentKeyEpochs.id })
    .from(documentContentKeyEpochs)
    .where(eq(documentContentKeyEpochs.documentId, created.id))
    .limit(1);
  invariant(contentKeyEpoch, "expected document content-key epoch");

  await db
    .update(documentContentKeyTargets)
    .set({
      containerKeyEpochId: "tampered-container-key-epoch",
    })
    .where(
      eq(
        documentContentKeyTargets.documentContentKeyEpochId,
        contentKeyEpoch.id,
      ),
    );

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(409);
});

test("GET /documents/:documentId/writer-projection rejects stale document KEK targets", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  await db.insert(accessManifestDocumentLinkProjection).values({
    containerId: crypto.randomUUID(),
    documentId: created.id,
    manifestHash: created.accessManifest.manifestHash,
  });

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(409);
  expect(await projectionResponse.json()).toEqual({
    code: "document_projection_kek_targets_unavailable",
    error: "Container manifest head missing",
  });
});

test("GET /documents/:documentId/writer-projection rejects malformed stored document state", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  await db
    .update(accessManifests)
    .set({
      state: {
        ...created.accessManifest.state,
        linkedContainerIds: "not-linked-container-ids",
      } as KeyingCanonicalJson,
    })
    .where(
      eq(accessManifests.manifestHash, created.accessManifest.manifestHash),
    );

  const projectionResponse = await routeApp.request(
    `/documents/${created.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(409);
});

test("POST /documents/:documentId/link advances a signed link-set manifest", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  const request = await buildDocumentLinkRequest({
    child,
    createdDocument,
    owner,
    root,
  });

  const response = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );

  expect(response.status).toBe(200);
  const linked = await response.json();
  expect(isDocumentLinkSetMutationResponse(linked)).toBe(true);
  expect(linked.accessManifest.manifestHash).toBe(request.expectedManifestHash);
  expect(linked.accessManifest.event.body.eventType).toBe("document.link");
  expect(linked.documentKekTargets.targets).toHaveLength(2);
  expect(linked.contentKeyBundle.targets).toHaveLength(2);

  const rows = await db
    .select({ containerId: documentContainerLinks.containerId })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, createdDocument.id));
  expect(rows.map((row) => row.containerId).sort()).toEqual(
    [root.kekState.containerId, child.containerId].sort(),
  );
});

test("GET /documents/:documentId/writer-projection returns multi-linked container paths", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  const linkResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await buildDocumentLinkRequest({
          child,
          createdDocument,
          owner,
          root,
        }),
      ),
    },
  );
  expect(linkResponse.status).toBe(200);
  const linked = await linkResponse.json();
  expect(isDocumentLinkSetMutationResponse(linked)).toBe(true);

  const projectionResponse = await routeApp.request(
    `/documents/${createdDocument.id}/writer-projection`,
    {
      headers: {
        Authorization: `Bearer ${owner.token}`,
      },
    },
  );

  expect(projectionResponse.status).toBe(200);
  const projection = await projectionResponse.json();
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);
  const writerProjection = projection as DocumentWriterProjectionResponse;
  expect(
    writerProjection.documentManifestHistory?.map(
      (bundle) => bundle.manifestHash,
    ),
  ).toEqual([createdDocument.accessManifest.manifestHash]);
  expect(
    new Map(
      writerProjection.documentManifestContainerPaths?.map((path) => [
        path.at(-1)?.manifestHash,
        path.map((bundle) => bundle.manifestHash),
      ]),
    ),
  ).toEqual(
    new Map([
      [root.bundle.manifestHash, [root.bundle.manifestHash]],
      [
        child.accessManifest.manifestHash,
        [root.bundle.manifestHash, child.accessManifest.manifestHash],
      ],
    ]),
  );
  expect(writerProjection.documentKekTargets.targets).toHaveLength(2);
  const pathsByContainerId = new Map(
    writerProjection.authorizingContainerPaths.map((path) => [
      path.containerId,
      path.path.map((entry) => entry.manifestHash),
    ]),
  );
  expect(pathsByContainerId).toEqual(
    new Map([
      [root.kekState.containerId, [root.bundle.manifestHash]],
      [
        child.containerId,
        [root.bundle.manifestHash, child.accessManifest.manifestHash],
      ],
    ]),
  );
});

test("POST /documents/:documentId/link rejects stale previous manifests", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  const staleRequest = await buildDocumentLinkRequest({
    child,
    createdDocument,
    owner,
    root,
  });
  const linkedResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(staleRequest),
    },
  );
  expect(linkedResponse.status).toBe(200);

  const nextChild = await createChildContainer({
    parent: root,
    signer: owner,
  });
  const staleSecondRequest = await buildDocumentLinkRequest({
    child: nextChild,
    createdDocument,
    owner,
    root,
  });
  const staleResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(staleSecondRequest),
    },
  );

  expect(staleResponse.status).toBe(409);
  // The server resolves the previous manifest from the current head, so a stale
  // link is rejected at the signed-event chain check (event.previousManifestHash
  // no longer matches the advanced head) rather than the downstream head pin.
  expect(await staleResponse.json()).toEqual({
    error:
      "document access event previous manifest does not match supplied previous manifest",
  });
});

test("POST /documents/:documentId/unlink advances a signed link-set manifest", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  const preRotationSync = await createSignedDocumentSyncRequest({
    created: createdDocument,
    owner,
    root,
  });
  expect(
    (await postDocumentSync(createdDocument.id, owner, preRotationSync.request))
      .status,
  ).toBe(200);
  const linkRequest = await buildDocumentLinkRequest({
    child,
    createdDocument,
    owner,
    root,
  });
  const linkResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(linkRequest),
    },
  );
  expect(linkResponse.status).toBe(200);
  const linkedDocument = await linkResponse.json();
  expect(isDocumentLinkSetMutationResponse(linkedDocument)).toBe(true);
  const preUnlinkUpdatedAt = new Date("2026-05-05T00:00:00.000Z");
  await db
    .update(documents)
    .set({ updatedAt: preUnlinkUpdatedAt })
    .where(eq(documents.id, createdDocument.id));
  await db
    .update(containers)
    .set({ updatedAt: preUnlinkUpdatedAt })
    .where(
      inArray(containers.id, [root.kekState.containerId, child.containerId]),
    );

  const missingBaselineRequest = await buildDocumentUnlinkRequest({
    child,
    linkedDocument,
    owner,
    root,
  });
  delete missingBaselineRequest.rotationBaseline;
  const missingBaselineResponse = await routeApp.request(
    `/documents/${createdDocument.id}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(missingBaselineRequest),
    },
  );
  expect(missingBaselineResponse.status).toBe(409);
  expect(await missingBaselineResponse.json()).toEqual({
    error:
      "Document unlink requires a rotation baseline covering committed updates",
  });

  await expectStaleAtomicUnlinkRollsBack({
    buildRequest: () =>
      buildDocumentUnlinkRequest({
        child,
        linkedDocument,
        owner,
        root,
        rotationBaselineSourceVersionVector: emptyVersionVector(),
      }),
    documentId: createdDocument.id,
    token: owner.token,
  });

  const unlinkRequest = await buildDocumentUnlinkRequest({
    child,
    linkedDocument,
    owner,
    root,
  });
  const unlinkResponse = await routeApp.request(
    `/documents/${createdDocument.id}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(unlinkRequest),
    },
  );

  expect(unlinkResponse.status).toBe(200);
  const unlinked = await unlinkResponse.json();
  expect(isDocumentLinkSetMutationResponse(unlinked)).toBe(true);
  expect(unlinked.accessManifest.manifestHash).toBe(
    unlinkRequest.expectedManifestHash,
  );
  expect(unlinked.accessManifest.event.body.eventType).toBe("document.unlink");
  expect(unlinked.documentKekTargets.targets).toHaveLength(1);
  expect(unlinked.documentKekTargets.targets[0].containerId).toBe(
    root.kekState.containerId,
  );
  expect(unlinked.contentKeyBundle.contentKeyEpoch).toBe(
    linkedDocument.contentKeyBundle.contentKeyEpoch + 1,
  );

  const rows = await db
    .select({ containerId: documentContainerLinks.containerId })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, createdDocument.id));
  expect(rows.map((row) => row.containerId)).toEqual([
    root.kekState.containerId,
  ]);

  const [documentRow] = await db
    .select({ updatedAt: documents.updatedAt })
    .from(documents)
    .where(eq(documents.id, createdDocument.id))
    .limit(1);
  const touchedContainerRows = await db
    .select({
      id: containers.id,
      updatedAt: containers.updatedAt,
    })
    .from(containers)
    .where(
      inArray(containers.id, [root.kekState.containerId, child.containerId]),
    );
  const [tombstoneRow] = await db
    .select({
      containerId: containerDocumentSyncTombstones.containerId,
      documentId: containerDocumentSyncTombstones.documentId,
      updatedAt: containerDocumentSyncTombstones.updatedAt,
    })
    .from(containerDocumentSyncTombstones)
    .where(
      and(
        eq(containerDocumentSyncTombstones.containerId, child.containerId),
        eq(containerDocumentSyncTombstones.documentId, createdDocument.id),
      ),
    )
    .limit(1);
  invariant(documentRow, "expected touched document row");
  const unlinkUpdatedAt = documentRow.updatedAt.toISOString();
  expect(unlinkUpdatedAt).not.toBe(preUnlinkUpdatedAt.toISOString());
  expect(
    touchedContainerRows.map((row) => [row.id, row.updatedAt.toISOString()]),
  ).toEqual(
    expect.arrayContaining([
      [root.kekState.containerId, unlinkUpdatedAt],
      [child.containerId, unlinkUpdatedAt],
    ]),
  );
  expect(tombstoneRow).toEqual({
    containerId: child.containerId,
    documentId: createdDocument.id,
    updatedAt: documentRow.updatedAt,
  });
});

test("POST /documents/:documentId/unlink accepts a baseline-less unlink for an empty committed frontier", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const createdDocument = await createDocument({ owner, root });
  const linkRequest = await buildDocumentLinkRequest({
    child,
    createdDocument,
    owner,
    root,
  });
  const linkResponse = await routeApp.request(
    `/documents/${createdDocument.id}/link`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(linkRequest),
    },
  );
  expect(linkResponse.status).toBe(200);
  const linkedDocument = await linkResponse.json();
  expect(isDocumentLinkSetMutationResponse(linkedDocument)).toBe(true);

  const unlinkRequest = await buildDocumentUnlinkRequest({
    child,
    linkedDocument,
    owner,
    root,
  });
  // A document with no committed updates has nothing for a rotation baseline
  // to cover, so the unlink may omit it entirely.
  delete unlinkRequest.rotationBaseline;
  const unlinkResponse = await routeApp.request(
    `/documents/${createdDocument.id}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(unlinkRequest),
    },
  );

  expect(unlinkResponse.status).toBe(200);
  const unlinked = await unlinkResponse.json();
  expect(isDocumentLinkSetMutationResponse(unlinked)).toBe(true);
  expect(unlinked.accessManifest.manifestHash).toBe(
    unlinkRequest.expectedManifestHash,
  );
  expect(unlinked.contentKeyBundle.contentKeyEpoch).toBe(
    linkedDocument.contentKeyBundle.contentKeyEpoch + 1,
  );

  const rows = await db
    .select({ containerId: documentContainerLinks.containerId })
    .from(documentContainerLinks)
    .where(eq(documentContainerLinks.documentId, createdDocument.id));
  expect(rows.map((row) => row.containerId)).toEqual([
    root.kekState.containerId,
  ]);

  const baselineRows = await db
    .select({ id: documentUpdates.id })
    .from(documentUpdates)
    .where(eq(documentUpdates.documentId, createdDocument.id));
  expect(baselineRows).toHaveLength(0);
});

test("POST /documents/:documentId/unlink rejects removing the final signed link", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const createdDocument = await createDocument({ owner, root });
  const body: DocumentAccessEventBody = {
    eventType: "document.unlink",
    containerId: root.kekState.containerId,
    containerManifestHash: root.bundle.manifestHash,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [root.bundle.manifestHash],
    objectId: createdDocument.id,
    objectKind: "document",
    organizationId: asVerifiedContainerManifest(root.bundle).state
      .organizationId,
    previousManifestHash: createdDocument.accessManifest.manifestHash,
    signer: owner,
  });
  const request: DocumentLinkSetMutationRequest = {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown as Record<string, unknown>,
    expectedManifestHash: createdDocument.accessManifest.manifestHash,
    manifest: createdDocument.accessManifest.manifest,
    targetContainerPathRefs: [
      {
        containerId: root.kekState.containerId,
        manifestHash: root.bundle.manifestHash,
      },
    ],
    authorizingContainerPathRefs: [
      [
        {
          containerId: root.kekState.containerId,
          manifestHash: root.bundle.manifestHash,
        },
      ],
    ],
    contentKeyBundle: {
      contentKeyEpoch: createdDocument.contentKeyBundle.contentKeyEpoch,
      linkSetManifestHash: createdDocument.accessManifest.manifestHash,
      targetHash: createdDocument.contentKeyBundle.targetHash,
      targets: createdDocument.contentKeyBundle.targets,
    },
  };

  const response = await routeApp.request(
    `/documents/${createdDocument.id}/unlink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "document.unlink must leave at least one linked container",
  });
});
