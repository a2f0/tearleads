import { afterAll, expect, test } from "bun:test";
import {
  decryptAsRecipient,
  encryptForRecipients,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  hexToBytes,
  sign,
  toFingerprint,
} from "@tearleads/crypto";
import invariant from "invariant";
import { del } from "../../src/adapters/redis";
import {
  createItem,
  fetchEncapsulationKey,
  getItem,
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

// --- Encrypted message from Bob to Alice ---

let itemId: string;

test("Bob encrypts 'Hi, Alice' for Alice and stores it via setItem", async () => {
  // Bob fetches Alice's encapsulation public key
  const res = await fetchEncapsulationKey(alice.userId, bob.token);
  expect(res.status).toBe(200);
  const { encapsulationPublicKey: aliceKeyBase64 } = await res.json();
  const aliceEncapsulationKey = new Uint8Array(
    Buffer.from(aliceKeyBase64, "base64"),
  );

  // Bob encrypts the message for Alice
  const plaintext = new TextEncoder().encode("Hi, Alice");
  const envelope = await encryptForRecipients(plaintext, [
    aliceEncapsulationKey,
  ]);

  // Serialize the envelope for storage
  const serializedEnvelope = JSON.stringify({
    iv: Array.from(envelope.iv),
    ciphertext: Array.from(envelope.ciphertext),
    recipients: envelope.recipients.map((r) => ({
      keyFingerprint: r.keyFingerprint,
      kemCipherText: Array.from(r.kemCipherText),
      wrappedKey: Array.from(r.wrappedKey),
    })),
  });

  // Store via setItem endpoint
  const itemRes = await createItem(serializedEnvelope, "", "", bob.token);
  expect(itemRes.status).toBe(200);

  const itemBody = await itemRes.json();
  expect(typeof itemBody.id).toBe("string");
  expect(itemBody.id.length).toBeGreaterThan(0);
  itemId = itemBody.id;
});

test("Alice retrieves the item and decrypts the message", async () => {
  const res = await getItem(itemId, alice.token);
  expect(res.status).toBe(200);

  const body = await res.json();
  expect(body.id).toBe(itemId);

  // Deserialize the envelope from the payload
  const parsed = JSON.parse(body.payload);
  const envelope = {
    iv: new Uint8Array(parsed.iv),
    ciphertext: new Uint8Array(parsed.ciphertext),
    recipients: parsed.recipients.map(
      (r: {
        keyFingerprint: string;
        kemCipherText: number[];
        wrappedKey: number[];
      }) => ({
        keyFingerprint: r.keyFingerprint,
        kemCipherText: new Uint8Array(r.kemCipherText),
        wrappedKey: new Uint8Array(r.wrappedKey),
      }),
    ),
  };

  // Alice decrypts with her KEM secret key
  const decrypted = await decryptAsRecipient(envelope, alice.kem.secretKey);
  const message = new TextDecoder().decode(decrypted);
  expect(message).toBe("Hi, Alice");
});
