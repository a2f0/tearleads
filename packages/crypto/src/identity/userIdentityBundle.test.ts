import { expect, test } from "bun:test";
import { computeUserIdentityBundleFingerprint } from "./userIdentityBundle";

const identity = {
  identityTrustDomain: "https://api.example.test/v1",
  userId: "11111111-1111-4111-8111-111111111111",
  signingPublicKey: new Uint8Array(2592).fill(1),
  encapsulationPublicKey: new Uint8Array(1568).fill(2),
};

test("identity bundle fingerprint preserves the identity-link v1 canonical bytes", async () => {
  // Independently computed with Python hashlib.sha256 over the documented
  // compact UTF-8 JSON tuple, not with this implementation's serializer.
  expect(await computeUserIdentityBundleFingerprint(identity)).toBe(
    "8d33d788d5c4f3d595c29426201bbf2975331be28c1ada9c29f80be24f21a578",
  );
});

test("identity bundle binds both keys, user, and deployment including base path", async () => {
  const expected = await computeUserIdentityBundleFingerprint(identity);
  for (const changed of [
    { ...identity, identityTrustDomain: "https://api.example.test/other" },
    { ...identity, userId: "22222222-2222-4222-8222-222222222222" },
    { ...identity, signingPublicKey: new Uint8Array(2592).fill(3) },
    { ...identity, encapsulationPublicKey: new Uint8Array(1568).fill(4) },
  ]) {
    expect(await computeUserIdentityBundleFingerprint(changed)).not.toBe(
      expected,
    );
  }
});
