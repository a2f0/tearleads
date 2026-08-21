import { expect, test } from "bun:test";
import { createTestUser } from "@symcrypt/bob-and-alice";
import {
  authChallengeSigningBytes,
  generateSigningSeedAndKeyPair,
  hexToBytes,
  sign,
  toFingerprint,
} from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  createRegistrationRequest,
  createServiceTestRuntime,
} from "../../../test/helpers/serviceRuntime";
import { CreateChallengeError, createChallenge } from "./createChallenge";
import { registerUser } from "./registration";
import { VerifyChallengeError, verifyChallenge } from "./verifyChallenge";

async function registerAuthServiceUser() {
  const runtime = createServiceTestRuntime();
  const user = createTestUser();
  await registerUser(runtime, await createRegistrationRequest(user));
  const fingerprint = await toFingerprint(user.signing.signingPublicKey);

  return { fingerprint, runtime, user };
}

async function expectCreateChallengeError(
  promise: Promise<unknown>,
): Promise<CreateChallengeError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CreateChallengeError);
    return error as CreateChallengeError;
  }

  throw new Error("Expected createChallenge to fail");
}

async function expectVerifyChallengeError(
  promise: Promise<unknown>,
): Promise<VerifyChallengeError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(VerifyChallengeError);
    return error as VerifyChallengeError;
  }

  throw new Error("Expected verifyChallenge to fail");
}

test("createChallenge returns a service result for a known fingerprint", async () => {
  const { fingerprint, runtime } = await registerAuthServiceUser();

  const result = await createChallenge(runtime, { fingerprint });

  expect(result.challenge).toHaveLength(64);
});

test("createChallenge throws a service error for an unknown fingerprint", async () => {
  const error = await expectCreateChallengeError(
    createChallenge(createServiceTestRuntime(), {
      fingerprint: "unknown-fingerprint",
    }),
  );

  expect(error.reason).toBe("unknown_fingerprint");
});

test("verifyChallenge returns a session token for a valid signature", async () => {
  const { fingerprint, runtime, user } = await registerAuthServiceUser();
  const { challenge } = await createChallenge(runtime, { fingerprint });
  const signature = sign(
    authChallengeSigningBytes({ challengeHex: challenge, fingerprint }),
    user.signing.signingPrivateKey,
  );

  const result = await verifyChallenge(runtime, {
    fingerprint,
    signature: Array.from(signature),
  });

  expect(result.token).toBe("test-session");
});

test("verifyChallenge rejects raw challenge signatures without the auth domain", async () => {
  const { fingerprint, runtime, user } = await registerAuthServiceUser();
  const { challenge } = await createChallenge(runtime, { fingerprint });
  const signature = sign(hexToBytes(challenge), user.signing.signingPrivateKey);

  const error = await expectVerifyChallengeError(
    verifyChallenge(runtime, {
      fingerprint,
      signature: Array.from(signature),
    }),
  );

  expect(error.reason).toBe("invalid_signature");
});

test("verifyChallenge uses the canonical database signing key when redis drifts", async () => {
  const { fingerprint, runtime, user } = await registerAuthServiceUser();
  const staleKeys = generateSigningSeedAndKeyPair();
  await runtime.keyValueStore.set(
    fingerprint,
    bytesToBase64(staleKeys.signingPublicKey),
  );
  const { challenge } = await createChallenge(runtime, { fingerprint });
  const staleSignature = sign(
    authChallengeSigningBytes({ challengeHex: challenge, fingerprint }),
    staleKeys.signingPrivateKey,
  );

  const staleError = await expectVerifyChallengeError(
    verifyChallenge(runtime, {
      fingerprint,
      signature: Array.from(staleSignature),
    }),
  );
  expect(staleError.reason).toBe("invalid_signature");

  const nextChallenge = await createChallenge(runtime, { fingerprint });
  const canonicalSignature = sign(
    authChallengeSigningBytes({
      challengeHex: nextChallenge.challenge,
      fingerprint,
    }),
    user.signing.signingPrivateKey,
  );

  const result = await verifyChallenge(runtime, {
    fingerprint,
    signature: Array.from(canonicalSignature),
  });
  expect(result.token).toBe("test-session");
});

test("verifyChallenge rejects challenges backed only by stale redis keys", async () => {
  const runtime = createServiceTestRuntime();
  const staleKeys = generateSigningSeedAndKeyPair();
  const fingerprint = await toFingerprint(staleKeys.signingPublicKey);
  await runtime.keyValueStore.set(
    fingerprint,
    bytesToBase64(staleKeys.signingPublicKey),
  );
  const { challenge } = await createChallenge(runtime, { fingerprint });
  const signature = sign(
    authChallengeSigningBytes({ challengeHex: challenge, fingerprint }),
    staleKeys.signingPrivateKey,
  );

  const error = await expectVerifyChallengeError(
    verifyChallenge(runtime, {
      fingerprint,
      signature: Array.from(signature),
    }),
  );

  expect(error.reason).toBe("unknown_fingerprint");
});

test("verifyChallenge throws service errors for auth failures", async () => {
  const { fingerprint, runtime } = await registerAuthServiceUser();

  const missingChallenge = await expectVerifyChallengeError(
    verifyChallenge(runtime, {
      fingerprint: "missing-challenge",
      signature: Array.from(new Uint8Array(32)),
    }),
  );
  expect(missingChallenge.reason).toBe("challenge_not_found");

  const { challenge } = await createChallenge(runtime, { fingerprint });
  const wrongUser = createTestUser();
  const invalidSignature = sign(
    authChallengeSigningBytes({ challengeHex: challenge, fingerprint }),
    wrongUser.signing.signingPrivateKey,
  );
  const badSignature = await expectVerifyChallengeError(
    verifyChallenge(runtime, {
      fingerprint,
      signature: Array.from(invalidSignature),
    }),
  );
  expect(badSignature.reason).toBe("invalid_signature");
});
