import { expect, mock, test } from "bun:test";
import type { OrganizationDirectory } from "@tearleads/client-sdk";
import { resolveGroupIdentity } from "./resolveGroupIdentity";

test("a server directory row cannot enroll an unpinned identity without a link", async () => {
  const directoryUser = {
    userId: "bob",
  } as OrganizationDirectory["users"][number];
  const resolvePinned = mock(async () => null);
  const verifyLink = mock(async () => {
    throw new Error("Expected an identity link");
  });
  await expect(
    resolveGroupIdentity({
      directoryUser,
      value: "bob",
      resolvePinned,
      verifyLink,
    }),
  ).rejects.toThrow("identity link");
  expect(resolvePinned).toHaveBeenCalledWith("bob");
  expect(verifyLink).not.toHaveBeenCalled();
});

test("known roster pins are reused; new links must verify before group mutations", async () => {
  const identity = {
    userId: "bob",
    signingPublicKey: "signing",
    signingKeyFingerprint: "s",
    encapsulationPublicKey: "encryption",
    encapsulationKeyFingerprint: "e",
  };
  const directoryUser = {
    userId: "bob",
  } as OrganizationDirectory["users"][number];
  const resolvePinned = mock(async () => identity);
  const verifyLink = mock(async () => identity);
  expect(
    await resolveGroupIdentity({
      directoryUser,
      value: "bob",
      resolvePinned,
      verifyLink,
    }),
  ).toEqual(identity);
  expect(verifyLink).not.toHaveBeenCalled();
  expect(
    await resolveGroupIdentity({
      directoryUser: undefined,
      value: "identity-link",
      resolvePinned,
      verifyLink,
    }),
  ).toEqual(identity);
  expect(verifyLink).toHaveBeenCalledWith("identity-link");
  verifyLink.mockImplementation(async () => {
    throw new Error("Identity keys do not match");
  });
  await expect(
    resolveGroupIdentity({
      directoryUser: undefined,
      value: "bad-link",
      resolvePinned,
      verifyLink,
    }),
  ).rejects.toThrow("do not match");
});
