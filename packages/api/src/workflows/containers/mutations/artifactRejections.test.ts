import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
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
  readonly status?: number;
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
  expect(response.status).toBe(input.status ?? 409);
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

async function postChildCreate(
  token: string,
  request: ContainerMutationRequest,
): Promise<Response> {
  return await routeApp.request("/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

test("a mutation refuses a principal policy ref that is not the current head", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildChildCreateRequest({ root, signer: owner });
  const [ref] = request.principalPolicyRefs;
  if (!ref) throw new Error("expected a principal policy ref");
  request.principalPolicyRefs = [{ ...ref, stateHash: "0".repeat(64) }];

  const response = await postChildCreate(owner.token, request);
  expect(response.status).toBe(409);
  const body = (await response.json()) as {
    readonly code?: unknown;
    readonly principalHeads?: unknown;
  };
  expect(body.code).toBe("principal_policy_stale");
  expect(body.principalHeads).toEqual([
    expect.objectContaining({
      principalId: ref.principalId,
      stateHash: ref.stateHash,
      version: ref.version,
    }),
  ]);
}, 15_000);

test("a mutation refuses more principal policy refs than the bound", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildChildCreateRequest({ root, signer: owner });
  const [ref] = request.principalPolicyRefs;
  if (!ref) throw new Error("expected a principal policy ref");
  request.principalPolicyRefs = Array.from({ length: 4097 }, () => ref);

  const response = await postChildCreate(owner.token, request);
  expect(response.status).toBe(400);
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

async function shareRequestCitingHistory(
  history: (
    historical: NonNullable<
      ContainerMutationRequest["containerManifestHistoryRefs"]
    >[number],
  ) => ContainerMutationRequest["containerManifestHistoryRefs"],
) {
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
  request.containerManifestHistoryRefs = history(historical);
  return { owner, request, root };
}

// Malformed history is refused before any citation is read: the cited hash
// is unstored, so a resolving server would report it missing instead.
test("a mutation refuses repeated history citations before reading them", async () => {
  const { owner, request, root } = await shareRequestCitingHistory(
    (historical) => {
      const unstored = { ...historical, manifestHash: "e".repeat(64) };
      return [unstored, unstored];
    },
  );

  await expectRejection({
    error: "containerManifestHistoryRefs[1] repeats a cited manifest",
    path: `/containers/${root.kekState.containerId}/share`,
    request,
    status: 400,
    token: owner.token,
  });
}, 15_000);

test("a mutation refuses history citing another container before reading it", async () => {
  const { owner, request, root } = await shareRequestCitingHistory(
    (historical) => [
      { containerId: "another-container", manifestHash: "e".repeat(64) },
      historical,
    ],
  );

  await expectRejection({
    error: "containerManifestHistoryRefs[0] cites another container",
    path: `/containers/${root.kekState.containerId}/share`,
    request,
    status: 400,
    token: owner.token,
  });
}, 15_000);

test("a mutation refuses a path citing one manifest twice before reading it", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildChildCreateRequest({ root, signer: owner });
  const [parent] = request.parentContainerPathRefs ?? [];
  if (!parent) throw new Error("expected a parent manifest reference");
  // Unstored, so a resolving server would report it missing instead.
  const unstored = { ...parent, manifestHash: "f".repeat(64) };
  request.parentContainerPathRefs = [unstored, unstored];

  await expectRejection({
    error: "parentContainerPathRefs[1] repeats a cited manifest",
    path: "/containers",
    request,
    status: 400,
    token: owner.token,
  });
}, 15_000);
