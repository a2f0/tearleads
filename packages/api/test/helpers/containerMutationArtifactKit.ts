import type { TestUser } from "@symcrypt/bob-and-alice";
import type { ContainerAccessEventBody } from "@symcrypt/crypto";
import type { ContainerMutationRequest } from "@symcrypt/validators/request";
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
}): Promise<ContainerMutationRequest> {
  const parentBundle = input.root.bundle;
  const parentManifest = asVerifiedContainerManifest(parentBundle);
  const containerId = crypto.randomUUID();
  const metadataDocumentId = crypto.randomUUID();
  const { containerKeyEpochId } = await createTestContainerKekMaterial({
    containerId,
    keyEpoch: 1,
  });
  const body: ContainerAccessEventBody = {
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
    dependencyManifestHashes: [parentBundle.manifestHash],
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
  const principalPolicies = await loadPrincipalPoliciesForContainerPath([
    parentBundle,
  ]);

  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    parentContainerPath: [parentBundle],
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
