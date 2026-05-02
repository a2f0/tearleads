import {
  authChallengeSigningBytes,
  toFingerprint,
  verify,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import { users } from "../../schema";
import type { ApiServiceRuntime } from "../runtime";

interface VerifyChallengeInput {
  fingerprint: string;
  signature: number[];
}

interface VerifyChallengeResult {
  token: string;
}

type VerifyChallengeErrorReason =
  | "challenge_not_found"
  | "invalid_signature"
  | "unknown_fingerprint";

export class VerifyChallengeError extends Error {
  constructor(
    message: string,
    readonly reason: VerifyChallengeErrorReason,
  ) {
    super(message);
  }
}

export async function verifyChallenge(
  runtime: ApiServiceRuntime,
  input: VerifyChallengeInput,
): Promise<VerifyChallengeResult> {
  const challengeHex = await runtime.keyValueStore.get(
    `challenge:${input.fingerprint}`,
  );
  if (!challengeHex) {
    throw new VerifyChallengeError(
      "Challenge expired or not found",
      "challenge_not_found",
    );
  }

  await runtime.keyValueStore.del(`challenge:${input.fingerprint}`);

  const [user] = await runtime.db
    .select({ id: users.id, signingPublicKey: users.signingPublicKey })
    .from(users)
    .where(eq(users.fingerprint, input.fingerprint))
    .limit(1);

  if (!user) {
    throw new VerifyChallengeError(
      "Unknown fingerprint",
      "unknown_fingerprint",
    );
  }

  const publicKey = base64ToBytes(user.signingPublicKey);
  // Defense in depth: the query matches the fingerprint column, but auth should
  // fail closed if stored signing key material ever drifts from that binding.
  if ((await toFingerprint(publicKey)) !== input.fingerprint) {
    throw new VerifyChallengeError(
      "Unknown fingerprint",
      "unknown_fingerprint",
    );
  }

  const challengeBytes = authChallengeSigningBytes({
    challengeHex,
    fingerprint: input.fingerprint,
  });
  const signatureBytes = new Uint8Array(input.signature);

  if (!verify(signatureBytes, challengeBytes, publicKey)) {
    throw new VerifyChallengeError("Invalid signature", "invalid_signature");
  }

  const token = await runtime.sessionTokenIssuer.createSession({
    userId: user.id,
    fingerprint: input.fingerprint,
    createdAt: Date.now(),
  });

  return {
    token,
  };
}
