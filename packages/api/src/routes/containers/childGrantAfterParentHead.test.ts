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

// The cited parent manifest now sits two heads below the current one, so the
// intermediate is already process-cached when the child is verified. The
// creation citation must still resolve rather than depending on cache warmth.
test("a child share succeeds after its parent head advanced twice", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const r1 = createTestUser();
  await registerUser(r1);
  await authenticate(r1);
  const r2 = createTestUser();
  await registerUser(r2);
  await authenticate(r2);
  const r3 = createTestUser();
  await registerUser(r3);
  await authenticate(r3);

  const root = await bootstrapRoot(owner);
  const child = await createChildContainer({ parent: root, signer: owner });
  const childBundle = accessManifestFromContainerResponse(child);

  // root_v1 -> root_v2
  const s1 = await share(
    owner.token,
    root.kekState.containerId,
    await buildRootGrantRequest({
      previous: root.bundle,
      previousKekState: root.kekState,
      recipient: r1,
      signer: owner,
    }),
  );
  const t1 = await s1.text();
  expect(s1.status, t1.slice(0, 300)).toBe(200);
  const v2 = JSON.parse(t1);
  if (!isContainerMutationResponse(v2)) throw new Error("bad v2");

  // root_v2 -> root_v3  (v2 is now process-cached)
  const s2 = await share(
    owner.token,
    root.kekState.containerId,
    await buildContainerGrantRequest({
      containerManifestHistory: [root.bundle],
      parentKekState: null,
      previous: accessManifestFromContainerResponse(v2),
      previousContainerPath: [accessManifestFromContainerResponse(v2)],
      previousKekState: kekStateFromContainerResponse(v2),
      recipient: r2,
      signer: owner,
    }),
  );
  const t2 = await s2.text();
  expect(s2.status, t2.slice(0, 300)).toBe(200);
  const v3 = JSON.parse(t2);
  if (!isContainerMutationResponse(v3)) throw new Error("bad v3");

  // child still cites root_v1, which is now TWO levels below the head
  const cs = await share(
    owner.token,
    child.containerId,
    await buildContainerGrantRequest({
      parentKekState: kekStateFromContainerResponse(v3),
      previous: childBundle,
      previousContainerPath: [
        accessManifestFromContainerResponse(v3),
        childBundle,
      ],
      previousKekState: kekStateFromContainerResponse(child),
      recipient: r3,
      signer: owner,
    }),
  );
  const ct = await cs.text();
  expect(cs.status, ct.slice(0, 400)).toBe(200);
});

// Read-first ordering: a writer-projection GET warms both the child's creation
// manifest and the current parent head into the process-wide verification cache
// before either share runs, so `verifyBundle` short-circuits on both.
test("a child share succeeds after a projection read warmed the cache", async () => {
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

  const warmed = await routeApp.request(
    `/containers/${child.containerId}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(warmed.status, await warmed.text()).toBe(200);

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
      parentKekState: kekStateFromContainerResponse(rootResponse),
      previous: childBundle,
      previousContainerPath: [
        accessManifestFromContainerResponse(rootResponse),
        childBundle,
      ],
      previousKekState: kekStateFromContainerResponse(child),
      recipient: second,
      signer: owner,
    }),
  );
  const childShared = await childShare.text();
  expect(childShare.status, childShared.slice(0, 500)).toBe(200);
});
