import { expect } from "bun:test";
import type {
  ContainerAccessEventBody,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { computeContainerKekPredecessorBridgeHash } from "@tearleads/crypto";
import { containerWrappingPublicKeyForTest } from "@tearleads/crypto/test-fixtures";
import type { TestUser } from "@tearleads/test-utils";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import { routeApp } from "../../src/routeApp";
import {
  createTestContainerKekMaterial,
  createTestContainerKekPredecessorBridge,
  createTestRotationKeyring,
} from "./containerKekMaterial";
import { parentKekRef } from "./containerKeying";
import {
  containerManifestRef,
  containerManifestRefs,
} from "./containerManifestRefs";
import {
  asVerifiedContainerManifest,
  createContainerKeyEpoch,
  createContainerKeyWrap,
  createContainerManifestBundle,
  createSignedAccessEvent,
  loadPrincipalPoliciesForContainerPath,
  uniquePrincipalPolicies,
} from "./keyingWriterProjectionKit";
import { principalPolicyRefs } from "./principalPolicyRefs";
import {
  type StoredContainerMutation,
  withStoredContainerMutation,
} from "./storedContainerMutation";

async function loadPrincipalPoliciesForContainerPaths(
  paths: readonly (readonly AccessManifestBundleWire[])[],
): Promise<VerifiedPrincipalPolicy[]> {
  const principalPolicySets = await Promise.all(
    paths.map((path) => loadPrincipalPoliciesForContainerPath(path)),
  );

  return uniquePrincipalPolicies(principalPolicySets.flat());
}

export async function buildContainerMoveRequest(input: {
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
  const { keyring, keyringHash } = await createTestRotationKeyring({
    containerId: previous.state.containerId,
    retiringKeyEpoch: input.previousKekState.containerKeyEpoch,
    retiringContainerKeyEpochId: input.previousKekState.containerKeyEpochId,
    successorContainerKeyEpochId: containerKeyEpochId,
  });
  const body: ContainerAccessEventBody = {
    containerKeyPublicKey:
      containerWrappingPublicKeyForTest(containerKeyEpochId),
    eventType: "container.move",
    parentContainerId: destinationParent.state.containerId,
    parentManifestHash: input.destinationParent.manifestHash,
    containerKeyEpochId,
    keyringHash,
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
      containerKeyPublicKey: body.containerKeyPublicKey,
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
    previousManifestRef: containerManifestRef(input.previous),
    previousContainerPathRefs: containerManifestRefs(
      input.previousContainerPath,
    ),
    destinationParentContainerPathRefs: containerManifestRefs(
      input.destinationParentPath,
    ),
    principalPolicyRefs: principalPolicyRefs(principalPolicies),
    keyEpoch: keyEpoch as unknown as Record<string, unknown>,
    keyring: keyring as unknown as Record<string, unknown>,
    predecessorBridge: predecessorBridge as unknown as Record<string, unknown>,
    wraps: [wrap as unknown as Record<string, unknown>],
    parentKekRef: parentKekRef(input.destinationParentKekState),
    userRecipientKeys: [],
  };
}

export async function moveContainer(input: {
  readonly destinationParent: AccessManifestBundleWire;
  readonly destinationParentKekState: VerifiedContainerKekState;
  readonly destinationParentPath: readonly AccessManifestBundleWire[];
  readonly previous: AccessManifestBundleWire;
  readonly previousContainerPath: readonly AccessManifestBundleWire[];
  readonly previousKekState: VerifiedContainerKekState;
  readonly signer: TestUser;
}): Promise<StoredContainerMutation> {
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

  expect(response.status, await response.clone().text()).toBe(200);
  const moved = await response.json();
  if (!isContainerMutationResponse(moved))
    throw new Error("Expected a container move acknowledgement");
  return withStoredContainerMutation(moved);
}
