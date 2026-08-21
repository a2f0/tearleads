import { expect, test } from "bun:test";
import { createTestUser } from "@symcrypt/bob-and-alice";
import type { RegistrationRequest } from "@symcrypt/validators/request";
import { createRegistrationRequestBody } from "../../../test/helpers/api";
import {
  createTestContainerKekKeyring,
  createTestContainerKekMaterial,
  createTestContainerKekPredecessorBridge,
} from "../../../test/helpers/containerKekMaterial";
import { routeApp } from "../../routeApp";

async function createRegistrationBody(): Promise<RegistrationRequest> {
  const user = createTestUser();
  return createRegistrationRequestBody(
    user.signing.signingPublicKey,
    user.signing.signingPrivateKey,
    user.kem.publicKey,
  );
}

async function submitRegistration(
  body: RegistrationRequest,
): Promise<Response> {
  return routeApp.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function initialRootKeyEpochId(body: RegistrationRequest): string {
  return String(Reflect.get(body.initialRootContainer.keyEpoch, "id"));
}

test("an initial root container cannot attach a predecessor bridge", async () => {
  const body = await createRegistrationBody();
  const successor = await createTestContainerKekMaterial({
    containerId: body.rootContainerId,
    keyEpoch: 2,
  });
  body.initialRootContainer.predecessorBridge =
    (await createTestContainerKekPredecessorBridge({
      containerId: body.rootContainerId,
      predecessorContainerKeyEpochId: initialRootKeyEpochId(body),
      successorContainerKeyEpochId: successor.containerKeyEpochId,
    })) as unknown as Record<string, unknown>;

  const response = await submitRegistration(body);
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: "Initial root container KEK cannot have a predecessor bridge",
  });
}, 15_000);

test("an initial root container cannot attach a keyring", async () => {
  const body = await createRegistrationBody();
  const successor = await createTestContainerKekMaterial({
    containerId: body.rootContainerId,
    keyEpoch: 2,
  });
  body.initialRootContainer.keyring = (await createTestContainerKekKeyring({
    containerId: body.rootContainerId,
    keyEpoch: 2,
    retiringContainerKey: crypto.getRandomValues(new Uint8Array(32)),
    retiringContainerKeyEpochId: initialRootKeyEpochId(body),
    successorContainerKey: crypto.getRandomValues(new Uint8Array(32)),
    successorContainerKeyEpochId: successor.containerKeyEpochId,
  })) as unknown as Record<string, unknown>;

  const response = await submitRegistration(body);
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: "Initial root container KEK cannot have a keyring",
  });
}, 15_000);

test("an initial root container KEK must start at epoch 1", async () => {
  const body = await createRegistrationBody();
  body.initialRootContainer.keyEpoch = {
    ...body.initialRootContainer.keyEpoch,
    keyEpoch: 7,
  };

  const response = await submitRegistration(body);
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: "Initial root container KEK must start at epoch 1",
  });
}, 15_000);
