import { expect } from "bun:test";
import type { TestUser } from "@tearleads/bob-and-alice";
import type {
  ContainerAccessEventBody,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import {
  type ContainerMutationResponse,
  isContainerMutationResponse,
} from "@tearleads/validators/response";
import { routeApp } from "../../src/routeApp";
import { createTestContainerKekMaterial } from "./containerKekMaterial";
import {
  asVerifiedContainerManifest,
  createContainerKeyEpoch,
  createContainerKeyWrap,
  createContainerManifestBundle,
  createSignedAccessEvent,
  loadPrincipalPoliciesForContainerPath,
} from "./keyingWriterProjectionKit";

export async function createChildContainer(input: {
  readonly parent: {
    readonly bundle: AccessManifestBundleWire | VerifiedContainerAccessManifest;
    readonly kekState: VerifiedContainerKekState;
  };
  readonly signer: TestUser;
}): Promise<ContainerMutationResponse> {
  const parentBundle = input.parent.bundle as AccessManifestBundleWire;
  const containerId = crypto.randomUUID();
  const { containerKeyEpochId } = await createTestContainerKekMaterial({
    containerId,
    keyEpoch: 1,
  });
  const parentManifest = asVerifiedContainerManifest(parentBundle);
  const body: ContainerAccessEventBody = {
    eventType: "container.create",
    parentContainerId: parentManifest.state.containerId,
    parentManifestHash: parentBundle.manifestHash,
    metadataDocumentId: crypto.randomUUID(),
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
    parentBundle,
  ]);
  const request: ContainerMutationRequest = {
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
