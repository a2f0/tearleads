import { createTestUser, type TestUser } from "@tearleads/test-utils";
import type {
  AccessManifestBundleWire,
  ContainerReciteRequest,
} from "@tearleads/validators/request";
import { routeApp } from "../../src/routeApp";
import { authenticate } from "./authenticate";
import {
  containerManifestRef,
  containerManifestRefs,
} from "./containerManifestRefs";
import { createChildContainer } from "./keyingWriterProjectionChild";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createContainerManifestBundle,
  createSignedAccessEvent,
  loadPrincipalPoliciesForContainerPath,
} from "./keyingWriterProjectionKit";
import { principalPolicyRefs } from "./principalPolicyRefs";
import { registerUser } from "./registerUser";

export async function createReciteScenario() {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  return { owner, root, child };
}

export async function buildReciteRequest(input: {
  readonly path: AccessManifestBundleWire[];
  readonly signer: TestUser;
  readonly omitAncestor?: boolean;
  readonly keyEpochId?: string;
}): Promise<ContainerReciteRequest> {
  const previousBundle = input.path.at(-1);
  if (!previousBundle) throw new Error("Expected a previous container");
  const previous = asVerifiedContainerManifest(previousBundle);
  const body = {
    containerKeyPublicKey: previous.state.containerKeyPublicKey,
    eventType: "container.recite" as const,
    containerKeyEpochId: input.keyEpochId ?? previous.state.containerKeyEpochId,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: (input.omitAncestor
      ? [previousBundle]
      : input.path
    ).map((bundle) => bundle.manifestHash),
    objectId: previous.state.containerId,
    objectKind: "container",
    organizationId: previous.state.organizationId,
    previousManifestHash: previous.manifestHash,
    signer: input.signer,
  });
  const bundle = await createContainerManifestBundle(
    {
      ...previous.state,
      epoch: previous.state.epoch + 1,
      eventHash: event.eventHash,
      previousManifestHash: previous.manifestHash,
    },
    event,
  );
  return {
    body,
    event: { ...event.event },
    manifest: bundle.manifest,
    expectedManifestHash: bundle.manifestHash,
    previousManifestRef: containerManifestRef(previousBundle),
    previousContainerPathRefs: containerManifestRefs(input.path),
    principalPolicyRefs: principalPolicyRefs(
      await loadPrincipalPoliciesForContainerPath(input.path),
    ),
  };
}

export function postRecite(
  containerId: string,
  signer: TestUser,
  body: ContainerReciteRequest,
) {
  return routeApp.request(`/containers/${containerId}/recite`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${signer.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
