import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
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

test("a mutation rejects a parent-path citation of an unstored manifest", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildChildCreateRequest({ root, signer: owner });
  const [parent] = request.parentContainerPathRefs ?? [];
  if (!parent) throw new Error("expected a parent manifest reference");
  request.parentContainerPathRefs = [
    { ...parent, manifestHash: "f".repeat(64) },
  ];

  await expectRejection({
    error:
      "parentContainerPathRefs[0] is not a verified stored manifest: Container manifest bundle missing",
    path: "/containers",
    request,
    token: owner.token,
  });
}, 15_000);

test("a mutation rejects a citation naming another container", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildChildCreateRequest({ root, signer: owner });
  const [parent] = request.parentContainerPathRefs ?? [];
  if (!parent) throw new Error("expected a parent manifest reference");
  request.parentContainerPathRefs = [
    { ...parent, containerId: crypto.randomUUID() },
  ];

  await expectRejection({
    error:
      "parentContainerPathRefs[0] container id does not match the referenced manifest",
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

test("a mutation rejects manifest history citing an unstored manifest", async () => {
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
  const [historical] = request.containerManifestHistoryRefs ?? [];
  if (!historical) throw new Error("expected manifest history");
  request.containerManifestHistoryRefs = [
    { ...historical, manifestHash: "e".repeat(64) },
  ];

  await expectRejection({
    error:
      "containerManifestHistoryRefs[0] is not a verified stored manifest: Container manifest bundle missing",
    path: `/containers/${root.kekState.containerId}/share`,
    request,
    token: owner.token,
  });
}, 15_000);
