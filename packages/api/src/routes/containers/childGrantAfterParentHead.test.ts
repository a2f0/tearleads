import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  buildContainerGrantRequest,
  buildRootGrantRequest,
} from "../../../test/helpers/containerGrantMutation";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

const share = (token: string, id: string, request: ContainerMutationRequest) =>
  routeApp.request(`/containers/${id}/share`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

// Share the folder, then share the subfolder: the parent head advances without
// a KEK rotation, so the child's key epoch still cites the superseded parent
// manifest. The signed-citation binding must still resolve that evidence.
test("a child share succeeds after its parent head advanced", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const recipient = createTestUser();
  await registerUser(recipient);
  await authenticate(recipient);

  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const childBundle = accessManifestFromContainerResponse(child);
  const childKek = kekStateFromContainerResponse(child);

  const rootShare = await share(
    owner.token,
    root.kekState.containerId,
    await buildRootGrantRequest({
      previous: root.bundle,
      previousKekState: root.kekState,
      recipient,
      signer: owner,
    }),
  );
  const rootShared = await rootShare.text();
  expect(rootShare.status, rootShared.slice(0, 500)).toBe(200);
  const rootResponse = JSON.parse(rootShared);
  if (!isContainerMutationResponse(rootResponse)) {
    throw new Error("Expected a root mutation response");
  }
  const advancedRoot = accessManifestFromContainerResponse(rootResponse);

  const childShare = await share(
    owner.token,
    child.containerId,
    await buildContainerGrantRequest({
      parentKekState: kekStateFromContainerResponse(rootResponse),
      previous: childBundle,
      previousContainerPath: [advancedRoot, childBundle],
      previousKekState: childKek,
      recipient,
      signer: owner,
    }),
  );
  const childShared = await childShare.text();
  expect(childShare.status, childShared.slice(0, 500)).toBe(200);
});

// The same path with the child's creation manifest already in the process-wide
// verification cache, where `verifyBundle` short-circuits instead of recursing
// into the citations it would otherwise materialize.
test("a warm-cache child share succeeds after its parent head advanced", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const first = createTestUser();
  await registerUser(first);
  await authenticate(first);
  const second = createTestUser();
  await registerUser(second);
  await authenticate(second);

  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const childBundle = accessManifestFromContainerResponse(child);

  const warm = await share(
    owner.token,
    child.containerId,
    await buildContainerGrantRequest({
      parentKekState: root.kekState,
      previous: childBundle,
      previousContainerPath: [root.bundle, childBundle],
      previousKekState: kekStateFromContainerResponse(child),
      recipient: first,
      signer: owner,
    }),
  );
  const warmed = await warm.text();
  expect(warm.status, warmed.slice(0, 500)).toBe(200);
  const warmedResponse = JSON.parse(warmed);
  if (!isContainerMutationResponse(warmedResponse)) {
    throw new Error("Expected a child mutation response");
  }

  const rootShare = await share(
    owner.token,
    root.kekState.containerId,
    await buildRootGrantRequest({
      previous: root.bundle,
      previousKekState: root.kekState,
      recipient: first,
      signer: owner,
    }),
  );
  const rootShared = await rootShare.text();
  expect(rootShare.status, rootShared.slice(0, 500)).toBe(200);
  const rootResponse = JSON.parse(rootShared);
  if (!isContainerMutationResponse(rootResponse)) {
    throw new Error("Expected a root mutation response");
  }

  const childShare = await share(
    owner.token,
    child.containerId,
    await buildContainerGrantRequest({
      containerManifestHistory: [childBundle],
      parentKekState: kekStateFromContainerResponse(rootResponse),
      previous: accessManifestFromContainerResponse(warmedResponse),
      previousContainerPath: [
        accessManifestFromContainerResponse(rootResponse),
        accessManifestFromContainerResponse(warmedResponse),
      ],
      previousKekState: kekStateFromContainerResponse(warmedResponse),
      recipient: second,
      signer: owner,
    }),
  );
  const childShared = await childShare.text();
  expect(childShare.status, childShared.slice(0, 500)).toBe(200);
});
