import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@tearleads/crypto";

export type TestUser = {
  signing: ReturnType<typeof generateSigningSeedAndKeyPair>;
  kem: ReturnType<typeof generateKemSeedAndKeyPair>;
  fingerprint: string;
  rootContainerId: string;
  userId: string;
  token: string;
};

export function createTestUser(): TestUser {
  return {
    signing: generateSigningSeedAndKeyPair(),
    kem: generateKemSeedAndKeyPair(),
    fingerprint: "",
    rootContainerId: "",
    userId: "",
    token: "",
  };
}
