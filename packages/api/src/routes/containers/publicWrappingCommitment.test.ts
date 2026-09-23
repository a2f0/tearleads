import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  deriveContainerKekWrappingPublicKey,
  normalizeContainerAccessEventBody,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import {
  bootstrapRoot,
  createSignedAccessEvent,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("the server rejects a correctly signed rotation with an uncommitted public wrapping key", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const honest = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const containerId = honest.container.bundle.state.containerId;
  const body = {
    ...normalizeContainerAccessEventBody(honest.container.bundle.event.body),
    containerKeyPublicKey: await deriveContainerKekWrappingPublicKey({
      containerId,
      keyMaterial: crypto.getRandomValues(new Uint8Array(32)),
    }),
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes:
      honest.container.bundle.event.event.dependencyManifestHashes,
    objectId: containerId,
    objectKind: "container",
    organizationId: honest.container.bundle.state.organizationId,
    previousManifestHash: root.bundle.manifestHash,
    signer: owner,
  });
  const manifest = await deriveContainerAccessManifest({
    ...honest.container.bundle.state,
    containerKeyPublicKey: body.containerKeyPublicKey,
    eventHash: event.eventHash,
  });
  const manifestHash = await computeAccessManifestHash(manifest);
  const forged: ContainerMutationRequest = {
    ...honest.request,
    body,
    event: { ...event.event },
    manifest: { ...manifest },
    expectedManifestHash: manifestHash,
    keyEpoch: {
      ...honest.request.keyEpoch,
      accessManifestHash: manifestHash,
      createdByManifestHash: manifestHash,
      createdByEventHash: event.eventHash,
    },
    wraps: honest.request.wraps.map((wrap) => ({
      ...wrap,
      wrapManifestHash: manifestHash,
    })),
  };
  const submit = (request: ContainerMutationRequest) =>
    routeApp.request(`/containers/${containerId}/rekey`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  const refused = await submit(forged);
  expect(refused.status).toBe(409);
  expect(await refused.text()).toContain(
    "public key does not match its epoch commitment",
  );
  const accepted = await submit(honest.request);
  expect(accepted.status, await accepted.clone().text()).toBe(200);
});
