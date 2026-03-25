import { afterAll, expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  hexToBytes,
  sign,
  toFingerprint,
} from "@tearleads/crypto";
import invariant from "invariant";
import { del } from "../../src/adapters/redis";
import {
  fetchEncapsulationKey,
  requestChallenge,
  submitVerify,
  uploadKey,
} from "../helpers/api";

const alice = {
  signing: generateSigningSeedAndKeyPair(),
  kem: generateKemSeedAndKeyPair(),
  fingerprint: "",
  userId: "",
  token: "",
};

const bob = {
  signing: generateSigningSeedAndKeyPair(),
  kem: generateKemSeedAndKeyPair(),
  fingerprint: "",
  userId: "",
  token: "",
};

afterAll(async () => {
  await del(alice.fingerprint);
  await del(bob.fingerprint);
});

async function registerUser(user: typeof alice) {
  user.fingerprint = await toFingerprint(user.signing.signingPublicKey);

  const res = await uploadKey(
    user.signing.signingPublicKey,
    user.kem.publicKey,
  );
  expect(res.status).toBe(200);

  const body = await res.json();
  expect(body.message).toBe("ok");
  expect(typeof body.userId).toBe("string");
  user.userId = body.userId;

  return body.challenge as string;
}

async function authenticateWithChallenge(
  user: typeof alice,
  challengeHex: string,
) {
  const signature = sign(
    hexToBytes(challengeHex),
    user.signing.signingPrivateKey,
  );
  const res = await submitVerify(user.fingerprint, signature);
  expect(res.status).toBe(200);

  const body = await res.json();
  expect(body.authenticated).toBe(true);
  invariant(typeof body.token === "string", "expected token string");
  user.token = body.token;
}

async function authenticate(user: typeof alice) {
  const challengeRes = await requestChallenge(user.fingerprint);
  expect(challengeRes.status).toBe(200);

  const { challenge } = await challengeRes.json();
  invariant(typeof challenge === "string", "expected challenge string");

  await authenticateWithChallenge(user, challenge);
}

// --- Registration ---

test("Alice registers her key package", async () => {
  const challenge = await registerUser(alice);
  expect(alice.userId.length).toBeGreaterThan(0);
  expect(typeof challenge).toBe("string");
});

test("Bob registers his key package", async () => {
  const challenge = await registerUser(bob);
  expect(bob.userId.length).toBeGreaterThan(0);
  expect(typeof challenge).toBe("string");
});

// --- Authentication ---

test("Alice authenticates and establishes a session", async () => {
  await authenticate(alice);
  expect(alice.token.length).toBeGreaterThan(0);
});

test("Bob authenticates and establishes a session", async () => {
  await authenticate(bob);
  expect(bob.token.length).toBeGreaterThan(0);
});

// --- Cross-user key exchange ---

test("Alice can fetch Bob's encapsulation key", async () => {
  const res = await fetchEncapsulationKey(bob.userId, alice.token);
  expect(res.status).toBe(200);

  const body = await res.json();
  expect(body.userId).toBe(bob.userId);
  expect(typeof body.encapsulationPublicKey).toBe("string");
  expect(body.encapsulationPublicKey.length).toBeGreaterThan(0);
});

test("Bob can fetch Alice's encapsulation key", async () => {
  const res = await fetchEncapsulationKey(alice.userId, bob.token);
  expect(res.status).toBe(200);

  const body = await res.json();
  expect(body.userId).toBe(alice.userId);
  expect(typeof body.encapsulationPublicKey).toBe("string");
  expect(body.encapsulationPublicKey.length).toBeGreaterThan(0);
});

// --- Session isolation ---

test("Alice and Bob have distinct sessions", () => {
  expect(alice.token).not.toBe(bob.token);
  expect(alice.userId).not.toBe(bob.userId);
  expect(alice.fingerprint).not.toBe(bob.fingerprint);
});
