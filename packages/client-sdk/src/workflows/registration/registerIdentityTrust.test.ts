import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { respondToRegistration } from "../../../test/helpers/organizationProvisioningResponder";
import { type RegistrationApi, registerIdentity } from "./registerIdentity";

type RegisterUserParameters = Parameters<RegistrationApi["registerUser"]>;

test("registration pins the confirmed identity before persisting under it", async () => {
  const mismatch = new KeyingVerificationError(
    "equivocation",
    "Local identity does not match its durable pin",
  );
  let persistenceCalls = 0;
  const pinned: string[] = [];
  const registered: { userId: string | null } = { userId: null };

  await expect(
    registerIdentity({
      apiClient: {
        registerUser: async (...args: RegisterUserParameters) => {
          registered.userId = args[0];
          return respondToRegistration(args);
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
      pinLocalUserIdentity: async (userId) => {
        pinned.push(userId);
        throw mismatch;
      },
      signingKeyPair: generateSigningSeedAndKeyPair(),
    }),
  ).rejects.toBe(mismatch);

  // The pin names exactly the user the server confirmed, and a refused pin
  // stops registration before anything is persisted under that user.
  if (registered.userId === null) throw new Error("Expected a registration");
  expect(pinned).toEqual([registered.userId]);
  expect(persistenceCalls).toBe(0);
});

test("a registration the server does not confirm leaves no pin behind", async () => {
  // The trust store binds each signing key to one user. A pin for an id the
  // server never accepted — a retry after a lost response, or a restored key
  // that is already registered — would later refuse the key's real user at
  // login, so nothing may be pinned until the server confirms the id.
  const pinned: string[] = [];
  const response = await registerIdentity({
    apiClient: { registerUser: async () => null },
    containerId: crypto.randomUUID(),
    dbClient: { exec: async () => ({ rows: [] }) },
    encapsulationKeyPair: generateKemSeedAndKeyPair(),
    pinLocalUserIdentity: async (userId) => {
      pinned.push(userId);
    },
    signingKeyPair: generateSigningSeedAndKeyPair(),
  });
  expect(response).toBeNull();
  expect(pinned).toEqual([]);
});
