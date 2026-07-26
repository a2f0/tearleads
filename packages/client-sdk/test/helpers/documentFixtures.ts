import {
  computeContainerKekMaterialId,
  encryptWithDek,
  generateKemSeedAndKeyPair,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { fixtureHash } from "./documentFixturePrimitives";

export {
  createAuthor,
  createProjection,
  fixtureHash,
} from "./documentFixturePrimitives";
export {
  createLinkSetResponseFromRequest,
  createMaterializedSyncFixture,
  createPendingUpdateRecord,
  createPreparedUpdate,
  createResponse,
  createResponseFromRequest,
  createSignedSyncResponseUpdate,
  createSyncFixture,
  createSyncResponse,
  getOnlyTarget,
  projectionPathRefs,
} from "./documentResponseFixtures";
export { writerProjectionEvidence } from "./documentWriterProjectionFixtures";

interface DeepNonCanonicalRecord {
  next?: DeepNonCanonicalRecord;
  notJson?: undefined;
}

export function createDeepNonCanonicalRecord(
  depth: number,
): DeepNonCanonicalRecord {
  const root: DeepNonCanonicalRecord = {};
  let cursor = root;

  for (let index = 0; index < depth; index += 1) {
    const next: DeepNonCanonicalRecord = {};
    cursor.next = next;
    cursor = next;
  }

  cursor.notJson = undefined;
  return root;
}

export async function createUserContainerWrap(input: {
  containerKeyEpochId: string;
  containerKek: Uint8Array;
  publicKey: Uint8Array;
  userId: string;
  wrapManifestHash: string;
}) {
  const [recipient] = await wrapDekForRecipients(input.containerKek, [
    input.publicKey,
  ]);
  if (!recipient) {
    throw new Error("Expected recipient wrap");
  }

  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: "user" as const,
    recipientId: input.userId,
    recipientKeyEpochId: `user:${input.userId}:epoch-1`,
    recipientKeyFingerprint: recipient.keyFingerprint,
    kemCipherText: bytesToBase64(recipient.kemCipherText),
    wrappedKey: bytesToBase64(recipient.wrappedKey),
    wrapManifestHash: input.wrapManifestHash,
  };
}

export async function createContainerWrap(input: {
  childContainerKeyEpochId: string;
  childKek: Uint8Array;
  parentContainerId: string;
  parentContainerKeyEpochId: string;
  parentKeyEpochHash: string;
  parentKek: Uint8Array;
  wrapManifestHash: string;
}) {
  const encrypted = await encryptWithDek(input.childKek, input.parentKek);

  return {
    containerKeyEpochId: input.childContainerKeyEpochId,
    recipientKind: "container" as const,
    recipientId: input.parentContainerId,
    recipientKeyEpochId: input.parentContainerKeyEpochId,
    recipientKeyFingerprint: input.parentKeyEpochHash,
    kemCipherText: bytesToBase64(encrypted.iv),
    wrappedKey: bytesToBase64(encrypted.ciphertext),
    wrapManifestHash: input.wrapManifestHash,
  };
}

interface WrappedProjectionFixture {
  childContainerKek: Uint8Array;
  childContainerKeyEpochId: string;
  projection: ContainerWriterProjectionResponse;
  publicKey: Uint8Array;
  rootContainerKek: Uint8Array;
  rootContainerKeyEpochId: string;
  secretKey: Uint8Array;
}

function buildWrappedProjection(input: {
  childContainerId: string;
  childContainerKeyEpochId: string;
  childEventHash: string;
  childKeyEpochHash: string;
  childKeyTargetHash: string;
  childManifestHash: string;
  childWrap: ReturnType<typeof createContainerWrap> extends Promise<infer T>
    ? T
    : never;
  organizationId: string;
  rootContainerId: string;
  rootContainerKeyEpochId: string;
  rootEventHash: string;
  rootKeyEpochHash: string;
  rootKeyTargetHash: string;
  rootManifestHash: string;
  rootWrap: ReturnType<typeof createUserContainerWrap> extends Promise<infer T>
    ? T
    : never;
}): ContainerWriterProjectionResponse {
  const {
    childContainerId,
    childContainerKeyEpochId,
    childEventHash,
    childKeyEpochHash,
    childKeyTargetHash,
    childManifestHash,
    childWrap,
    organizationId,
    rootContainerId,
    rootContainerKeyEpochId,
    rootEventHash,
    rootKeyEpochHash,
    rootKeyTargetHash,
    rootManifestHash,
    rootWrap,
  } = input;

  return {
    containerId: childContainerId,
    organizationId,
    path: [
      {
        event: { event: {}, body: {}, eventHash: rootEventHash },
        manifest: {},
        manifestHash: rootManifestHash,
        state: { containerId: rootContainerId, organizationId },
      },
      {
        event: { event: {}, body: {}, eventHash: childEventHash },
        manifest: {},
        manifestHash: childManifestHash,
        state: { containerId: childContainerId, organizationId },
      },
    ],
    containerKeks: [
      {
        containerId: rootContainerId,
        accessManifestHash: rootManifestHash,
        containerKeyEpochId: rootContainerKeyEpochId,
        containerKeyEpoch: 1,
        keyEpoch: {
          id: rootContainerKeyEpochId,
          containerId: rootContainerId,
          keyEpoch: 1,
          accessManifestHash: rootManifestHash,
          parentContainerKeyEpochId: null,
          createdByEventHash: rootEventHash,
          createdByManifestHash: rootManifestHash,
        },
        keyEpochHash: rootKeyEpochHash,
        keyTargetHash: rootKeyTargetHash,
        parentContainerKeyEpochId: null,
        containerManifestHistory: [],
        recipientTargets: [{}],
        wraps: [rootWrap],
      },
      {
        containerId: childContainerId,
        accessManifestHash: childManifestHash,
        containerKeyEpochId: childContainerKeyEpochId,
        containerKeyEpoch: 1,
        keyEpoch: {
          id: childContainerKeyEpochId,
          containerId: childContainerId,
          keyEpoch: 1,
          accessManifestHash: childManifestHash,
          parentContainerKeyEpochId: rootContainerKeyEpochId,
          createdByEventHash: childEventHash,
          createdByManifestHash: childManifestHash,
        },
        keyEpochHash: childKeyEpochHash,
        keyTargetHash: childKeyTargetHash,
        parentContainerKeyEpochId: rootContainerKeyEpochId,
        containerManifestHistory: [],
        recipientTargets: [{}],
        wraps: [childWrap],
      },
    ],
  };
}

export async function createWrappedProjection(): Promise<WrappedProjectionFixture> {
  const keyPair = generateKemSeedAndKeyPair();
  const rootContainerId = "root-container";
  const childContainerId = "child-container";
  const organizationId = "organization-1";
  const rootManifestHash = await fixtureHash("root-container-manifest");
  const childManifestHash = await fixtureHash("child-container-manifest");
  const rootEventHash = await fixtureHash("root-container-event");
  const childEventHash = await fixtureHash("child-container-event");
  const rootKeyEpochHash = await fixtureHash("root-container-key-epoch");
  const childKeyEpochHash = await fixtureHash("child-container-key-epoch");
  const rootKeyTargetHash = await fixtureHash("root-container-key-target");
  const childKeyTargetHash = await fixtureHash("child-container-key-target");
  const rootContainerKek = crypto.getRandomValues(new Uint8Array(32));
  const childContainerKek = crypto.getRandomValues(new Uint8Array(32));
  const rootContainerKeyEpochId = await computeContainerKekMaterialId({
    containerId: rootContainerId,
    keyEpoch: 1,
    keyMaterial: rootContainerKek,
  });
  const childContainerKeyEpochId = await computeContainerKekMaterialId({
    containerId: childContainerId,
    keyEpoch: 1,
    keyMaterial: childContainerKek,
  });
  const rootWrap = await createUserContainerWrap({
    containerKeyEpochId: rootContainerKeyEpochId,
    containerKek: rootContainerKek,
    publicKey: keyPair.publicKey,
    userId: "user-1",
    wrapManifestHash: rootManifestHash,
  });
  const childWrap = await createContainerWrap({
    childContainerKeyEpochId,
    childKek: childContainerKek,
    parentContainerId: rootContainerId,
    parentContainerKeyEpochId: rootContainerKeyEpochId,
    parentKeyEpochHash: rootKeyEpochHash,
    parentKek: rootContainerKek,
    wrapManifestHash: childManifestHash,
  });

  return {
    childContainerKek,
    childContainerKeyEpochId,
    projection: buildWrappedProjection({
      childContainerId,
      childContainerKeyEpochId,
      childEventHash,
      childKeyEpochHash,
      childKeyTargetHash,
      childManifestHash,
      childWrap,
      organizationId,
      rootContainerId,
      rootContainerKeyEpochId,
      rootEventHash,
      rootKeyEpochHash,
      rootKeyTargetHash,
      rootManifestHash,
      rootWrap,
    }),
    publicKey: keyPair.publicKey,
    rootContainerKek,
    rootContainerKeyEpochId,
    secretKey: keyPair.secretKey,
  };
}

export async function createSiblingProjection(input: {
  baseProjection: ContainerWriterProjectionResponse;
  rootContainerKek: Uint8Array;
}): Promise<{
  projection: ContainerWriterProjectionResponse;
  siblingContainerKek: Uint8Array;
  siblingContainerKeyEpochId: string;
}> {
  const rootManifest = input.baseProjection.path[0];
  const rootKek = input.baseProjection.containerKeks[0];
  if (!rootManifest || !rootKek) {
    throw new Error("Expected root projection fixture");
  }

  const siblingContainerId = "sibling-container";
  const siblingManifestHash = await fixtureHash("sibling-container-manifest");
  const siblingEventHash = await fixtureHash("sibling-container-event");
  const siblingKeyEpochHash = await fixtureHash("sibling-container-key-epoch");
  const siblingKeyTargetHash = await fixtureHash(
    "sibling-container-key-target",
  );
  const siblingContainerKek = crypto.getRandomValues(new Uint8Array(32));
  const siblingContainerKeyEpochId = await computeContainerKekMaterialId({
    containerId: siblingContainerId,
    keyEpoch: 1,
    keyMaterial: siblingContainerKek,
  });
  const siblingWrap = await createContainerWrap({
    childContainerKeyEpochId: siblingContainerKeyEpochId,
    childKek: siblingContainerKek,
    parentContainerId: rootKek.containerId,
    parentContainerKeyEpochId: rootKek.containerKeyEpochId,
    parentKeyEpochHash: rootKek.keyEpochHash,
    parentKek: input.rootContainerKek,
    wrapManifestHash: siblingManifestHash,
  });

  return {
    projection: {
      containerId: siblingContainerId,
      organizationId: input.baseProjection.organizationId,
      path: [
        rootManifest,
        {
          event: {
            event: {},
            body: {},
            eventHash: siblingEventHash,
          },
          manifest: {},
          manifestHash: siblingManifestHash,
          state: {
            containerId: siblingContainerId,
            organizationId: input.baseProjection.organizationId,
          },
        },
      ],
      containerKeks: [
        rootKek,
        {
          containerId: siblingContainerId,
          accessManifestHash: siblingManifestHash,
          containerKeyEpochId: siblingContainerKeyEpochId,
          containerKeyEpoch: 1,
          keyEpoch: {
            id: siblingContainerKeyEpochId,
            containerId: siblingContainerId,
            keyEpoch: 1,
            accessManifestHash: siblingManifestHash,
            parentContainerKeyEpochId: rootKek.containerKeyEpochId,
            createdByEventHash: siblingEventHash,
            createdByManifestHash: siblingManifestHash,
          },
          keyEpochHash: siblingKeyEpochHash,
          keyTargetHash: siblingKeyTargetHash,
          parentContainerKeyEpochId: rootKek.containerKeyEpochId,
          containerManifestHistory: [],
          recipientTargets: [{}],
          wraps: [siblingWrap],
        },
      ],
    },
    siblingContainerKek,
    siblingContainerKeyEpochId,
  };
}
