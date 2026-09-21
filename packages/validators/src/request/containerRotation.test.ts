import { expect, test } from "bun:test";
import { ContainerMutationFailureResponseSchema } from "../response";
import { MAX_ROTATION_CONTAINER_REKEYS } from "../util";
import { isContainerMutationRequest, isContainerRotationRequest } from ".";

const rekey = {
  body: {},
  event: {},
  expectedManifestHash: "manifest-hash",
  keyEpoch: {},
  keyring: null,
  manifest: {},
  predecessorBridge: null,
  principalPolicies: [],
  wraps: [{ containerKeyEpochId: "epoch" }],
};

// A rekey, revoke, or move may carry the descendant rekeys it must commit with.
// Each ships a keyring sized by its epoch, so the list is bounded.

test("a rotation carries at most the rotation cap", () => {
  expect(isContainerRotationRequest(rekey)).toBe(true);
  expect(isContainerRotationRequest({ ...rekey, containerRekeys: [] })).toBe(
    true,
  );
  expect(
    isContainerRotationRequest({
      ...rekey,
      containerRekeys: Array.from(
        { length: MAX_ROTATION_CONTAINER_REKEYS },
        () => rekey,
      ),
    }),
  ).toBe(true);
  expect(
    isContainerRotationRequest({
      ...rekey,
      containerRekeys: Array.from(
        { length: MAX_ROTATION_CONTAINER_REKEYS + 1 },
        () => rekey,
      ),
    }),
  ).toBe(false);
});

test("a carried rekey is a whole mutation request, and the list is a list", () => {
  expect(
    isContainerRotationRequest({ ...rekey, containerRekeys: [{ body: {} }] }),
  ).toBe(false);
  expect(isContainerRotationRequest({ ...rekey, containerRekeys: 5 })).toBe(
    false,
  );
});

// Create and share validate with the loose mutation schema, which keeps unknown
// keys. That is why the API checks the field's shape itself on those routes.

test("the plain mutation schema does not validate carried rekeys", () => {
  expect(isContainerMutationRequest({ ...rekey, containerRekeys: 5 })).toBe(
    true,
  );
});

test("a refusal names at most the rotation cap, as non-empty ids", () => {
  const refusal = (requiredContainerIds: unknown) =>
    ContainerMutationFailureResponseSchema.safeParse({
      code: "container_descendant_rekeys_required",
      error: "Container rotation must carry its descendant rekeys",
      requiredContainerIds,
    }).success;
  expect(refusal(["upper", "lower"])).toBe(true);
  expect(
    refusal(
      Array.from({ length: MAX_ROTATION_CONTAINER_REKEYS }, () => "level"),
    ),
  ).toBe(true);
  expect(
    refusal(
      Array.from({ length: MAX_ROTATION_CONTAINER_REKEYS + 1 }, () => "level"),
    ),
  ).toBe(false);
  expect(refusal([""])).toBe(false);
});

test("both rekeys-required codes are registered, behavior-bearing codes", () => {
  for (const code of [
    "container_ancestor_rekeys_required",
    "container_descendant_rekeys_required",
  ]) {
    expect(
      ContainerMutationFailureResponseSchema.safeParse({ code, error: "x" })
        .success,
    ).toBe(true);
  }
  expect(
    ContainerMutationFailureResponseSchema.safeParse({
      code: "container_made_up",
      error: "x",
    }).success,
  ).toBe(false);
});
