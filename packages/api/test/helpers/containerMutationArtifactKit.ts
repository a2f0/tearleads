import type { TestUser } from "@tearleads/bob-and-alice";
import type { ContainerAccessEventBody } from "@tearleads/crypto";
import { containerWrappingPublicKeyForTest } from "@tearleads/crypto/test-fixtures";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import { createTestContainerKekMaterial } from "./containerKekMaterial";
import {
  asVerifiedContainerManifest,
  createContainerKeyEpoch,
  createContainerKeyWrap,
  createContainerManifestBundle,
  createSignedAccessEvent,
  loadPrincipalPoliciesForContainerPath,
  type StoredRootFixture,
} from "./keyingWriterProjectionKit";

export async function buildChildCreateRequest(input: {
  readonly root: StoredRootFixture;
  readonly signer: TestUser;
  readonly metadataDocumentId?: string;
  readonly parentPath?: readonly AccessManifestBundleWire[];
  readonly systemSlot?: string | null;
}): Promise<ContainerMutationRequest> {
  const parentBundle = input.root.bundle;
  const parentContainerPath = [...(input.parentPath ?? []), parentBundle];
  const parentManifest = asVerifiedContainerManifest(parentBundle);
  const containerId = crypto.randomUUID();
  const metadataDocumentId = input.metadataDocumentId ?? crypto.randomUUID();
  const { containerKeyEpochId } = await createTestContainerKekMaterial({
    containerId,
    keyEpoch: 1,
  });
  const body: ContainerAccessEventBody = {
    containerKeyPublicKey:
      containerWrappingPublicKeyForTest(containerKeyEpochId),
    systemSlot: input.systemSlot ?? null,
    eventType: "container.create",
    parentContainerId: parentManifest.state.containerId,
    parentManifestHash: parentBundle.manifestHash,
    metadataDocumentId,
    containerKeyEpochId,
    directGrants: [],
    referencedPrincipalHeads: [],
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: parentContainerPath.map(
      (head) => head.manifestHash,
    ),
    objectId: containerId,
    objectKind: "container",
    organizationId: parentManifest.state.organizationId,
    previousManifestHash: null,
    signer: input.signer,
  });
  const bundle = await createContainerManifestBundle(
    {
      containerKeyPublicKey:
        containerWrappingPublicKeyForTest(containerKeyEpochId),
      systemSlot: input.systemSlot ?? null,
      version: 1,
      containerId,
      organizationId: parentManifest.state.organizationId,
      epoch: 1,
      previousManifestHash: null,
      eventHash: event.eventHash,
      parentContainerId: parentManifest.state.containerId,
      parentManifestHash: parentBundle.manifestHash,
      metadataDocumentId,
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
    parentKekState: input.root.kekState,
  });
  const wrap = createContainerKeyWrap({
    containerKeyEpochId,
    parentKekState: input.root.kekState,
    wrapManifestHash: bundle.manifestHash,
  });
  const principalPolicies =
    await loadPrincipalPoliciesForContainerPath(parentContainerPath);

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    parentContainerPath,
    principalPolicies: principalPolicies as unknown as Record<
      string,
      unknown
    >[],
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    keyring: null,
    predecessorBridge: null,
    wraps: [wrap as unknown as Record<string, unknown>],
    parentKekState: input.root.kekState as unknown as Record<string, unknown>,
    userRecipientKeys: [],
  };
}
