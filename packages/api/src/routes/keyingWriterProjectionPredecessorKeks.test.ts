import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  type ContainerKekPredecessorBridge,
  unwrapContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import {
  type DocumentWriterProjectionResponse,
  isContainerMutationResponse,
  isDocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { createRegistrationRequestBody } from "../../test/helpers/api";
import { authenticate } from "../../test/helpers/authenticate";
import {
  createTestContainerKekMaterial,
  createTestContainerKekPredecessorBridge,
} from "../../test/helpers/containerKekMaterial";
import { buildRootContainerRekeyMutation } from "../../test/helpers/containerRekey";
import {
  bootstrapRoot,
  buildRootGrantRequest,
  createDocument,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import {
  getWriterProjection,
  shareAndRevokeRoot,
} from "../../test/helpers/staleBundleHealKit";
import { routeApp } from "../routeApp";

function rootContainerKek(projection: unknown) {
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);
  const typed = projection as DocumentWriterProjectionResponse;
  const path = typed.authorizingContainerPaths[0];
  if (!path) throw new Error("expected an authorizing container path");
  const kek = path.containerKeks.at(-1);
  if (!kek) throw new Error("expected a container KEK");
  return kek;
}

test("the projection serves the complete successor-to-predecessor KEK chain", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  const before = await getWriterProjection(owner, created.id);
  expect(before.response.status).toBe(200);
  expect(rootContainerKek(before.projection).predecessorKeks).toEqual([]);

  const { revokedKek } = await shareAndRevokeRoot({ owner, root });
  const after = await getWriterProjection(owner, created.id);
  expect(after.response.status).toBe(200);
  const current = rootContainerKek(after.projection);
  expect(current.containerKeyEpochId).toBe(revokedKek.containerKeyEpochId);
  expect(
    current.predecessorKeks.map((epoch) => epoch.containerKeyEpochId),
  ).toEqual([root.kekState.containerKeyEpochId]);

  const predecessor = current.predecessorKeks[0];
  if (!predecessor) throw new Error("expected a predecessor KEK epoch");
  expect(predecessor.containerKeyEpoch).toBe(1);
  expect(predecessor.bridge).toMatchObject({
    containerId: root.kekState.containerId,
    predecessorContainerKeyEpochId: root.kekState.containerKeyEpochId,
    successorContainerKeyEpochId: revokedKek.containerKeyEpochId,
  });
}, 15_000);

test("a member granted current access after rotation receives the same history chain", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const { revokedKek, revokedManifest } = await shareAndRevokeRoot({
    owner,
    root,
  });

  const newcomer = createTestUser();
  await registerUser(newcomer);
  await authenticate(newcomer);
  const grantRequest = await buildRootGrantRequest({
    previous: revokedManifest,
    previousKekState: revokedKek,
    recipient: newcomer,
    signer: owner,
  });
  const grantResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(grantRequest),
    },
  );
  expect(grantResponse.status).toBe(200);
  expect(isContainerMutationResponse(await grantResponse.json())).toBe(true);

  const newcomerView = await getWriterProjection(newcomer, created.id);
  expect(newcomerView.response.status).toBe(200);
  expect(
    rootContainerKek(newcomerView.projection).predecessorKeks.map(
      (epoch) => epoch.containerKeyEpochId,
    ),
  ).toEqual([root.kekState.containerKeyEpochId]);
}, 15_000);

test("the predecessor chain remains complete across consecutive rotations", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const firstRekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const firstResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/rekey`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(firstRekey.request),
    },
  );
  expect(firstResponse.status).toBe(200);
  const secondRekey = await buildRootContainerRekeyMutation({
    previous: firstRekey.container,
    signer: owner,
  });
  const secondResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/rekey`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(secondRekey.request),
    },
  );
  expect(secondResponse.status).toBe(200);

  const projection = await getWriterProjection(owner, created.id);
  expect(projection.response.status).toBe(200);
  const current = rootContainerKek(projection.projection);
  expect(
    current.predecessorKeks.map((epoch) => epoch.containerKeyEpochId),
  ).toEqual([
    firstRekey.kekState.containerKeyEpochId,
    root.kekState.containerKeyEpochId,
  ]);
  const predecessor = current.predecessorKeks[0];
  if (!predecessor) throw new Error("expected the first rekey predecessor");
  await expect(
    unwrapContainerKekPredecessorBridge({
      bridge: predecessor.bridge as unknown as ContainerKekPredecessorBridge,
      successorContainerKey: secondRekey.plaintextKek,
    }),
  ).resolves.toEqual(firstRekey.plaintextKek);
}, 15_000);

test("a KEK rotation without its immediate predecessor bridge fails closed", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  rekey.request.predecessorBridge = null;

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/rekey`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(rekey.request),
    },
  );
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({
    error: "Container KEK rotation requires its immediate predecessor bridge",
  });
}, 15_000);

test("a KEK rotation rejects mismatched predecessor bridge metadata", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const unrelated = await createTestContainerKekMaterial({
    containerId: root.kekState.containerId,
    keyEpoch: 99,
  });
  const mismatches = [
    ["containerId", crypto.randomUUID()],
    ["predecessorContainerKeyEpochId", unrelated.containerKeyEpochId],
    ["successorContainerKeyEpochId", unrelated.containerKeyEpochId],
  ] as const;

  for (const [field, value] of mismatches) {
    const request = structuredClone(rekey.request);
    const bridge = request.predecessorBridge;
    if (!bridge) throw new Error("expected a predecessor bridge");
    Reflect.set(bridge, field, value);
    const response = await routeApp.request(
      `/containers/${root.kekState.containerId}/rekey`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${owner.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Container KEK rotation requires its immediate predecessor bridge",
    });
  }
}, 15_000);

test("a KEK rotation reports a non-consecutive epoch independently", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  Reflect.set(
    rekey.request.keyEpoch,
    "keyEpoch",
    root.kekState.containerKeyEpoch + 2,
  );

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/rekey`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(rekey.request),
    },
  );
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({
    error: "Container KEK rotation must advance by exactly one epoch",
  });
}, 15_000);

test("a same-epoch grant cannot attach a predecessor bridge", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const newcomer = createTestUser();
  await registerUser(newcomer);
  const grant = await buildRootGrantRequest({
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient: newcomer,
    signer: owner,
  });
  const prospectiveRekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  grant.predecessorBridge = prospectiveRekey.request.predecessorBridge;

  const response = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(grant),
    },
  );
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({
    error: "An unchanged container KEK cannot replace its predecessor bridge",
  });
}, 15_000);

test("an initial root container cannot attach a predecessor bridge", async () => {
  const user = createTestUser();
  const body = await createRegistrationRequestBody(
    user.signing.signingPublicKey,
    user.signing.signingPrivateKey,
    user.kem.publicKey,
  );
  const keyEpoch = body.initialRootContainer.keyEpoch;
  const successor = await createTestContainerKekMaterial({
    containerId: body.rootContainerId,
    keyEpoch: 2,
  });
  body.initialRootContainer.predecessorBridge =
    (await createTestContainerKekPredecessorBridge({
      containerId: body.rootContainerId,
      predecessorContainerKeyEpochId: String(Reflect.get(keyEpoch, "id")),
      successorContainerKeyEpochId: successor.containerKeyEpochId,
    })) as unknown as Record<string, unknown>;

  const response = await routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: "Initial root container KEK cannot have a predecessor bridge",
  });
}, 15_000);
