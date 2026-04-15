import { expect, test } from "bun:test";
import { createTestUser } from "./createTestUser";

test("creates bob and alice", () => {
  const alice = createTestUser();
  const bob = createTestUser();

  expect(alice).not.toBe(bob);
  expect(alice.signing.signingPublicKey.length).toBeGreaterThan(0);
  expect(alice.kem.publicKey.length).toBeGreaterThan(0);
  expect(bob.signing.signingPublicKey.length).toBeGreaterThan(0);
  expect(bob.kem.publicKey.length).toBeGreaterThan(0);
  expect(Array.from(alice.signing.signingPublicKey)).not.toEqual(
    Array.from(bob.signing.signingPublicKey),
  );
  expect(Array.from(alice.kem.publicKey)).not.toEqual(
    Array.from(bob.kem.publicKey),
  );
});
