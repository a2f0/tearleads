import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { authenticate } from "../../../../test/helpers/authenticate";
import { buildChildCreateRequest } from "../../../../test/helpers/containerMutationArtifactKit";
import { bootstrapRoot } from "../../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../../test/helpers/registerUser";
import { routeApp } from "../../../routeApp";

// A child mutation cites its parent's KEK state by id and hash. The server
// compares the citation with the parent's current epoch in its own store.
async function childCreate(
  cite: (
    ref: NonNullable<ContainerMutationRequest["parentKekRef"]>,
  ) => ContainerMutationRequest["parentKekRef"],
) {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const request = await buildChildCreateRequest({ root, signer: owner });
  const ref = request.parentKekRef;
  if (!ref) throw new Error("expected a parent KEK citation");
  // The request carries the citation alone, never the parent's full state.
  expect(Object.keys(ref).sort()).toEqual([
    "containerId",
    "containerKeyEpochId",
    "keyEpochHash",
  ]);
  const response = await routeApp.request("/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...request, parentKekRef: cite(ref) }),
  });
  return { body: await response.json(), status: response.status };
}

test("a child create citing the current parent KEK epoch commits", async () => {
  expect((await childCreate((ref) => ref)).status).toBe(200);
}, 15_000);

test("a parent KEK citation of another epoch is refused as stale", async () => {
  for (const cite of [
    (ref: NonNullable<ContainerMutationRequest["parentKekRef"]>) => ({
      ...ref,
      keyEpochHash: "0".repeat(64),
    }),
    (ref: NonNullable<ContainerMutationRequest["parentKekRef"]>) => ({
      ...ref,
      containerKeyEpochId: crypto.randomUUID(),
    }),
  ]) {
    const rejected = await childCreate(cite);
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({
      code: CONTAINER_MUTATION_ERROR_CODES.stateStale,
      error: "Parent KEK state is stale",
    });
  }
}, 30_000);

test("a child create without a parent citation, or citing another container, is refused", async () => {
  await expect(childCreate(() => null)).resolves.toEqual({
    body: { error: "Parent KEK state is required" },
    status: 409,
  });
  await expect(
    childCreate((ref) => ({ ...ref, containerId: crypto.randomUUID() })),
  ).resolves.toEqual({
    body: { error: "Parent KEK state container mismatch" },
    status: 409,
  });
}, 30_000);
