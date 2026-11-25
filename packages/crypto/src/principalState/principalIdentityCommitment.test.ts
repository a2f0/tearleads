import { expect, test } from "bun:test";
import { computePrincipalProjectionRoot } from "./principalState";

test("principal projection commits the member's complete identity bundle", async () => {
  const member = {
    userId: "alice",
    role: "admin" as const,
    identityBundleFingerprint: "a".repeat(64),
  };
  const substituted = {
    ...member,
    identityBundleFingerprint: "b".repeat(64),
  };
  expect(await computePrincipalProjectionRoot([member])).not.toBe(
    await computePrincipalProjectionRoot([substituted]),
  );
});

for (const identityBundleFingerprint of ["", "a".repeat(63), "A".repeat(64)]) {
  test("principal projection rejects a noncanonical identity commitment", async () => {
    await expect(
      computePrincipalProjectionRoot([
        { userId: "alice", role: "admin", identityBundleFingerprint },
      ]),
    ).rejects.toThrow("identity bundle fingerprint");
  });
}

test("principal projection refuses legacy members without an identity commitment", async () => {
  const legacy = {
    userId: "alice",
    role: "admin" as const,
    identityBundleFingerprint: "a".repeat(64),
  };
  Reflect.deleteProperty(legacy, "identityBundleFingerprint");
  await expect(computePrincipalProjectionRoot([legacy])).rejects.toThrow(
    "identity bundle fingerprint",
  );
});
