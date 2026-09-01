import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { ContainerAccessManifestState } from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { isDocumentLinkSetMutationResponse } from "@tearleads/validators/response";
import { authenticate } from "../../test/helpers/authenticate";
import { buildRekeyRequest } from "../../test/helpers/containerMutationRotations";
import {
  buildDocumentLinkRequest,
  buildDocumentUnlinkRequest,
} from "../../test/helpers/documentLinkMutation";
import { createChildContainer } from "../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocument,
  kekStateFromContainerResponse,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import { getCurrentContainerKeyEpoch } from "../access/read/containerKekStore";
import { routeApp } from "../routeApp";

function rekeyedChildFixture(
  previous: ContainerMutationResponse,
  request: ContainerMutationRequest,
): ContainerMutationResponse {
  const previousBundle = accessManifestFromContainerResponse(previous);
  const previousState = asVerifiedContainerManifest(previousBundle).state;
  const body = request.body as {
    containerKeyEpochId: string;
    referencedPrincipalHeads?: ContainerAccessManifestState["referencedPrincipalHeads"];
  };
  const manifest = request.manifest as unknown as { eventHash: string };
  const state: ContainerAccessManifestState = {
    ...previousState,
    containerKeyEpochId: body.containerKeyEpochId,
    epoch: previousState.epoch + 1,
    eventHash: manifest.eventHash,
    previousManifestHash: previousBundle.manifestHash,
    referencedPrincipalHeads:
      body.referencedPrincipalHeads ?? previousState.referencedPrincipalHeads,
  };
  const previousKek = kekStateFromContainerResponse(previous);
  return {
    ...previous,
    accessManifest: {
      event: {
        body: request.body,
        event: request.event,
        eventHash: manifest.eventHash,
      },
      manifest: request.manifest,
      manifestHash: request.expectedManifestHash,
      state: state as unknown as Record<string, unknown>,
    } as unknown as ContainerMutationResponse["accessManifest"],
    containerKek: {
      ...previousKek,
      accessManifestHash: request.expectedManifestHash,
      containerKeyEpoch: previousKek.containerKeyEpoch + 1,
      containerKeyEpochId: body.containerKeyEpochId,
    } as unknown as ContainerMutationResponse["containerKek"],
  };
}

test("document link-set mutations can rekey their changed child container", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const created = await createDocument({ owner, root });
  const linkRekeyRequest = await buildRekeyRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromContainerResponse(child),
    previousContainerPath: [
      root.bundle,
      accessManifestFromContainerResponse(child),
    ],
    previousKekState: kekStateFromContainerResponse(child),
    signer: owner,
  });
  const linkChild = rekeyedChildFixture(child, linkRekeyRequest);
  const linkRequest = await buildDocumentLinkRequest({
    child: linkChild,
    createdDocument: created,
    owner,
    root,
  });
  linkRequest.containerRekeys = [linkRekeyRequest];

  const linkResponse = await routeApp.request(`/documents/${created.id}/link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(linkRequest),
  });
  const linked = await linkResponse.json();
  expect({ body: linked, status: linkResponse.status }).toMatchObject({
    status: 200,
  });
  expect(isDocumentLinkSetMutationResponse(linked)).toBe(true);

  const unlinkRekeyRequest = await buildRekeyRequest({
    parentKekState: root.kekState,
    previous: accessManifestFromContainerResponse(linkChild),
    previousContainerPath: [
      root.bundle,
      accessManifestFromContainerResponse(linkChild),
    ],
    previousKekState: kekStateFromContainerResponse(linkChild),
    signer: owner,
  });
  const unlinkChild = rekeyedChildFixture(linkChild, unlinkRekeyRequest);
  const unlinkRequest = await buildDocumentUnlinkRequest({
    child: unlinkChild,
    linkedDocument: linked,
    owner,
    root,
  });
  unlinkRequest.containerRekeys = [unlinkRekeyRequest];
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

  const unlinked = await unlinkResponse.json();
  expect({ body: unlinked, status: unlinkResponse.status }).toMatchObject({
    status: 200,
  });
  expect(isDocumentLinkSetMutationResponse(unlinked)).toBe(true);
  expect((await getCurrentContainerKeyEpoch(child.containerId, db))?.id).toBe(
    kekStateFromContainerResponse(unlinkChild).containerKeyEpochId,
  );
});
