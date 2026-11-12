import { expect, mock, test } from "bun:test";
import type { OrganizationDirectory } from "@tearleads/client-sdk";
import { resolveGroupIdentity } from "./resolveGroupIdentity";

test("an active roster selection reaches SDK admission without trusting directory keys", async () => {
  const directoryUser = {
    userId: "bob",
    status: "active",
    signingPublicKey: "untrusted-directory-signing-key",
    encapsulationPublicKey: "untrusted-directory-encryption-key",
  } as OrganizationDirectory["users"][number];
  const resolveVerified = mock(async () => null);
  const verifyLink = mock(async () => {
    throw new Error("Expected an identity link");
  });
  expect(
    await resolveGroupIdentity({
      directoryUser,
      value: "bob",
      resolveVerified,
      verifyLink,
    }),
  ).toEqual({ userId: "bob" });
  expect(resolveVerified).not.toHaveBeenCalled();
  expect(verifyLink).not.toHaveBeenCalled();
});

test("a disabled directory entry still needs direct verification before re-enrollment", async () => {
  const directoryUser = {
    userId: "bob",
    status: "disabled",
  } as OrganizationDirectory["users"][number];
  const resolveVerified = mock(async () => null);
  const verifyLink = mock(async () => {
    throw new Error("Expected an identity link");
  });
  await expect(
    resolveGroupIdentity({
      directoryUser,
      value: "bob",
      resolveVerified,
      verifyLink,
    }),
  ).rejects.toThrow("identity link");
  expect(resolveVerified).toHaveBeenCalledWith("bob");
  expect(verifyLink).not.toHaveBeenCalled();
});

test("directly verified disabled users can rejoin; new links must verify before group mutations", async () => {
  const identity = {
    userId: "bob",
    signingPublicKey: "signing",
    signingKeyFingerprint: "s",
    encapsulationPublicKey: "encryption",
    encapsulationKeyFingerprint: "e",
  };
  const directoryUser = {
    userId: "bob",
    status: "disabled",
  } as OrganizationDirectory["users"][number];
  const resolveVerified = mock(async () => identity);
  const verifyLink = mock(async () => identity);
  expect(
    await resolveGroupIdentity({
      directoryUser,
      value: "bob",
      resolveVerified,
      verifyLink,
    }),
  ).toEqual(identity);
  expect(verifyLink).not.toHaveBeenCalled();
  expect(
    await resolveGroupIdentity({
      directoryUser: undefined,
      value: "identity-link",
      resolveVerified,
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
      resolveVerified,
      verifyLink,
    }),
  ).rejects.toThrow("do not match");
});
