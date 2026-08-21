import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  KeyingVerificationError,
} from "@symcrypt/crypto";
import { registerIdentity } from "./registerIdentity";

test("registration pins the local identity before network or persistence", async () => {
  const mismatch = new KeyingVerificationError(
    "equivocation",
    "Local identity does not match its durable pin",
  );
  let persistenceCalls = 0;
  let registerUserCalls = 0;

  await expect(
    registerIdentity({
      apiClient: {
        registerUser: async () => {
          registerUserCalls += 1;
          return null;
        },
      },
      containerId: crypto.randomUUID(),
      dbClient: {
        exec: async () => {
          persistenceCalls += 1;
          return { rows: [] };
        },
      },
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
      pinLocalUserIdentity: async () => {
        throw mismatch;
      },
      signingKeyPair: generateSigningSeedAndKeyPair(),
    }),
  ).rejects.toBe(mismatch);

  expect(registerUserCalls).toBe(0);
  expect(persistenceCalls).toBe(0);
});
