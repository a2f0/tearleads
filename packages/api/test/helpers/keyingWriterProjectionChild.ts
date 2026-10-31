import { expect } from "bun:test";
import type {
  ContainerAccessEventBody,
  VerifiedContainerAccessManifest,
  VerifiedContainerKekState,
} from "@tearleads/crypto";
import { containerWrappingPublicKeyForTest } from "@tearleads/crypto/test-fixtures";
import type { TestUser } from "@tearleads/test-utils";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import { routeApp } from "../../src/routeApp";
import { createTestContainerKekMaterial } from "./containerKekMaterial";
import { parentKekRef } from "./containerKeying";
import { containerManifestRefs } from "./containerManifestRefs";
import {
  asVerifiedContainerManifest,
  createContainerKeyEpoch,
  createContainerKeyWrap,
  createContainerManifestBundle,
  createSignedAccessEvent,
  loadPrincipalPoliciesForContainerPath,
} from "./keyingWriterProjectionKit";
import { principalPolicyRefs } from "./principalPolicyRefs";
import {
  type StoredContainerMutation,
  withStoredContainerMutation,
} from "./storedContainerMutation";

export interface CreateChildContainerInput {
  readonly parent: {
    readonly bundle: AccessManifestBundleWire | VerifiedContainerAccessManifest;
    readonly kekState: VerifiedContainerKekState;
  };
  // The parent's own ancestors, root first; empty when the parent is a root.
  readonly parentPath?: readonly AccessManifestBundleWire[] | undefined;
  readonly signer: TestUser;
}

export async function createChildContainer(
  input: CreateChildContainerInput,
): Promise<StoredContainerMutation> {
  return (await createChildContainerFixture(input)).response;
}

/** A created child plus the plaintext KEK a later grant on it must wrap. */
export async function createChildContainerFixture(
  input: CreateChildContainerInput,
): Promise<{
  readonly containerKeyEpochId: string;
  readonly plaintextKek: Uint8Array;
  readonly response: StoredContainerMutation;
}> {
  const parentBundle = input.parent.bundle as AccessManifestBundleWire;
  const parentContainerPath = [...(input.parentPath ?? []), parentBundle];
  const containerId = crypto.randomUUID();
  const { containerKeyEpochId, plaintextKek } =
    await createTestContainerKekMaterial({
      containerId,
      keyEpoch: 1,
    });
  const parentManifest = asVerifiedContainerManifest(parentBundle);
  const body: ContainerAccessEventBody = {
    containerKeyPublicKey:
      containerWrappingPublicKeyForTest(containerKeyEpochId),
    systemSlot: null,
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
    dependencyManifestHashes: parentContainerPath.map(
      (bundle) => bundle.manifestHash,
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
      systemSlot: null,
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
  const principalPolicies =
    await loadPrincipalPoliciesForContainerPath(parentContainerPath);
  const request: ContainerMutationRequest = {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    parentContainerPathRefs: containerManifestRefs(parentContainerPath),
    principalPolicyRefs: principalPolicyRefs(principalPolicies),
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    keyring: null,
    predecessorBridge: null,
    wraps: [wrap as unknown as Record<string, unknown>],
    parentKekRef: parentKekRef(input.parent.kekState),
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
  if (!isContainerMutationResponse(created))
    throw new Error("Expected a container mutation acknowledgement");
  return {
    containerKeyEpochId,
    plaintextKek,
    response: await withStoredContainerMutation(created),
  };
}
