import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import type { ContainerMutationRequest } from "@symcrypt/validators/request";
import { authenticate } from "../../../../test/helpers/authenticate";
import { buildChildCreateRequest } from "../../../../test/helpers/containerMutationArtifactKit";
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

async function expectRejection(input: {
  readonly error: string;
  readonly path: string;
  readonly request: ContainerMutationRequest;
  readonly token: string;
}): Promise<void> {
  const response = await routeApp.request(input.path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.request),
  });
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({ error: input.error });
}

function withTamperedEventSignature(
  bundle: NonNullable<ContainerMutationRequest["previousManifest"]>,
) {
  const tampered = structuredClone(bundle);
  const eventBundle = Reflect.get(tampered, "event");
  if (typeof eventBundle !== "object" || eventBundle === null) {
    throw new Error("expected an event bundle");
  }
  const event = Reflect.get(eventBundle, "event");
  if (typeof event !== "object" || event === null) {
    throw new Error("expected a signed event");
  }
  Reflect.set(event, "signature", "tampered-signature");
  return tampered;
}

test("a mutation rejects a tampered stored parent-path artifact", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildChildCreateRequest({ root, signer: owner });
  const [parent] = request.parentContainerPath ?? [];
  if (!parent) throw new Error("expected a parent manifest");
  request.parentContainerPath = [withTamperedEventSignature(parent)];

  await expectRejection({
    error: "parentContainerPath[0] does not match verified stored manifest",
    path: "/containers",
    request,
    token: owner.token,
  });
}, 15_000);

test("a mutation rejects a tampered principal policy artifact", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildChildCreateRequest({ root, signer: owner });
  const [policy] = request.principalPolicies;
  if (!policy) throw new Error("expected a principal policy");
  Reflect.set(policy, "grants", [
    { accessLevel: "admin", containerId: crypto.randomUUID() },
  ]);

  await expectRejection({
    error: "Principal policy artifact does not match verified stored policy",
    path: "/containers",
    request,
    token: owner.token,
  });
}, 15_000);

test("a mutation rejects tampered stored manifest history", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const recipient = createTestUser();
  await registerAndAuthenticate(recipient);
  const root = await bootstrapRoot(owner);
  const request = await buildRootGrantRequest({
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient,
    signer: owner,
  });
  const [historical] = request.containerManifestHistory ?? [];
  if (!historical) throw new Error("expected manifest history");
  request.containerManifestHistory = [withTamperedEventSignature(historical)];

  await expectRejection({
    error:
      "containerManifestHistory[0] does not match verified stored manifest",
    path: `/containers/${root.kekState.containerId}/share`,
    request,
    token: owner.token,
  });
}, 15_000);
