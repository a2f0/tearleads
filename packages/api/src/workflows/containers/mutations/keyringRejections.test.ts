import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import { MAX_CONTAINER_KEY_EPOCH } from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import type { ContainerMutationRequest } from "@symcrypt/validators/request";
import { authenticate } from "../../../../test/helpers/authenticate";
import {
  createTestContainerKekKeyring,
  createTestContainerKekMaterial,
  createTestFillerKeyringEntries,
} from "../../../../test/helpers/containerKekMaterial";
import { buildChildCreateRequest } from "../../../../test/helpers/containerMutationArtifactKit";
import { buildRootContainerRekeyMutation } from "../../../../test/helpers/containerRekey";
import {
  bootstrapRoot,
  buildRootGrantRequest,
} from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import { routeApp } from "../../../routeApp";

async function registerAndAuthenticate(user: TestUser): Promise<void> {
  await registerUser(user);
  await authenticate(user);
}

async function postMutation(input: {
  readonly path: string;
  readonly request: ContainerMutationRequest;
  readonly token: string;
}): Promise<Response> {
  return routeApp.request(input.path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.request),
  });
}

async function expectRejection(
  response: Response,
  error: string,
): Promise<void> {
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({ error });
}

function requestKeyEpochId(request: ContainerMutationRequest): string {
  return String(Reflect.get(request.keyEpoch, "id"));
}

/**
 * A rotation keyring resealed for the rekey's target epoch id but at a
 * different entry count than the target epoch requires — the exact-length
 * equality must reject both directions.
 */
async function resealKeyringAtEpoch(input: {
  readonly containerId: string;
  readonly retiringContainerKeyEpochId: string;
  readonly sealedKeyEpoch: number;
  readonly successorContainerKeyEpochId: string;
}): Promise<Record<string, unknown>> {
  const keyring = await createTestContainerKekKeyring({
    containerId: input.containerId,
    keyEpoch: input.sealedKeyEpoch,
    predecessorEntries: await createTestFillerKeyringEntries({
      containerId: input.containerId,
      count: input.sealedKeyEpoch - 2,
    }),
    retiringContainerKey: crypto.getRandomValues(new Uint8Array(32)),
    retiringContainerKeyEpochId: input.retiringContainerKeyEpochId,
    successorContainerKey: crypto.getRandomValues(new Uint8Array(32)),
    successorContainerKeyEpochId: input.successorContainerKeyEpochId,
  });
  return keyring as unknown as Record<string, unknown>;
}

test("a rotation rejects an over-length keyring sealed for a later epoch", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  rekey.request.keyring = await resealKeyringAtEpoch({
    containerId: root.kekState.containerId,
    retiringContainerKeyEpochId: root.kekState.containerKeyEpochId,
    sealedKeyEpoch: 3,
    successorContainerKeyEpochId: requestKeyEpochId(rekey.request),
  });

  await expectRejection(
    await postMutation({
      path: `/containers/${root.kekState.containerId}/rekey`,
      request: rekey.request,
      token: owner.token,
    }),
    "Container KEK keyring length does not match its key epoch",
  );
}, 15_000);

test("a rotation rejects an under-length keyring sealed for an earlier epoch", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const firstRekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const firstResponse = await postMutation({
    path: `/containers/${root.kekState.containerId}/rekey`,
    request: firstRekey.request,
    token: owner.token,
  });
  expect(firstResponse.status).toBe(200);

  const secondRekey = await buildRootContainerRekeyMutation({
    previous: firstRekey.container,
    signer: owner,
  });
  secondRekey.request.keyring = await resealKeyringAtEpoch({
    containerId: root.kekState.containerId,
    retiringContainerKeyEpochId: firstRekey.kekState.containerKeyEpochId,
    sealedKeyEpoch: 2,
    successorContainerKeyEpochId: requestKeyEpochId(secondRekey.request),
  });

  await expectRejection(
    await postMutation({
      path: `/containers/${root.kekState.containerId}/rekey`,
      request: secondRekey.request,
      token: owner.token,
    }),
    "Container KEK keyring length does not match its key epoch",
  );
}, 15_000);

test("a rotation rejects keyring ciphertext not committed by its signed event", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  // Same epoch window and target id, freshly sealed: the shape and length
  // pass, but the sealed bytes no longer match the signed keyringHash.
  rekey.request.keyring = await resealKeyringAtEpoch({
    containerId: root.kekState.containerId,
    retiringContainerKeyEpochId: root.kekState.containerKeyEpochId,
    sealedKeyEpoch: 2,
    successorContainerKeyEpochId: requestKeyEpochId(rekey.request),
  });

  await expectRejection(
    await postMutation({
      path: `/containers/${root.kekState.containerId}/rekey`,
      request: rekey.request,
      token: owner.token,
    }),
    "Container KEK keyring does not match its signed event",
  );
}, 15_000);

test("a rotation without its keyring fails closed", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  rekey.request.keyring = null;

  await expectRejection(
    await postMutation({
      path: `/containers/${root.kekState.containerId}/rekey`,
      request: rekey.request,
      token: owner.token,
    }),
    "Container KEK rotation requires a keyring sealed to its new epoch",
  );
}, 15_000);

test("a rotation rejects a keyring sealed to the wrong epoch id", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const unrelated = await createTestContainerKekMaterial({
    containerId: root.kekState.containerId,
    keyEpoch: 2,
  });
  rekey.request.keyring = await resealKeyringAtEpoch({
    containerId: root.kekState.containerId,
    retiringContainerKeyEpochId: root.kekState.containerKeyEpochId,
    sealedKeyEpoch: 2,
    successorContainerKeyEpochId: unrelated.containerKeyEpochId,
  });

  await expectRejection(
    await postMutation({
      path: `/containers/${root.kekState.containerId}/rekey`,
      request: rekey.request,
      token: owner.token,
    }),
    "Container KEK rotation requires a keyring sealed to its new epoch",
  );
}, 15_000);

test("an initial container KEK epoch rejects rotation artifacts", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const prospectiveRekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const create = await buildChildCreateRequest({ root, signer: owner });
  create.keyring = prospectiveRekey.request.keyring;

  await expectRejection(
    await postMutation({
      path: "/containers",
      request: create,
      token: owner.token,
    }),
    "Initial container KEK epoch cannot have rotation artifacts",
  );
}, 15_000);

test("a same-epoch grant cannot attach rotation artifacts", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
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
  grant.keyring = prospectiveRekey.request.keyring;

  await expectRejection(
    await postMutation({
      path: `/containers/${root.kekState.containerId}/share`,
      request: grant,
      token: owner.token,
    }),
    "An unchanged container KEK cannot replace its rotation artifacts",
  );
}, 15_000);

test("a rotation without its immediate predecessor bridge fails closed", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  rekey.request.predecessorBridge = null;

  await expectRejection(
    await postMutation({
      path: `/containers/${root.kekState.containerId}/rekey`,
      request: rekey.request,
      token: owner.token,
    }),
    "Container KEK rotation requires its immediate predecessor bridge",
  );
}, 15_000);

test("a rotation rejects bridge ciphertext not committed by its signed event", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const bridge = rekey.request.predecessorBridge;
  if (!bridge) throw new Error("expected a predecessor bridge");
  Reflect.set(
    bridge,
    "wrappedKey",
    bytesToBase64(crypto.getRandomValues(new Uint8Array(48))),
  );

  await expectRejection(
    await postMutation({
      path: `/containers/${root.kekState.containerId}/rekey`,
      request: rekey.request,
      token: owner.token,
    }),
    "Container KEK predecessor bridge does not match its signed event",
  );
}, 15_000);

test("a rotation reports a non-consecutive epoch independently", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
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

  await expectRejection(
    await postMutation({
      path: `/containers/${root.kekState.containerId}/rekey`,
      request: rekey.request,
      token: owner.token,
    }),
    "Container KEK rotation must advance by exactly one epoch",
  );
}, 15_000);

test("a rotation past the lifetime epoch cap fails closed", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const rekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  Reflect.set(rekey.request.keyEpoch, "keyEpoch", MAX_CONTAINER_KEY_EPOCH + 1);

  await expectRejection(
    await postMutation({
      path: `/containers/${root.kekState.containerId}/rekey`,
      request: rekey.request,
      token: owner.token,
    }),
    "Container KEK rotation limit reached",
  );
}, 15_000);
