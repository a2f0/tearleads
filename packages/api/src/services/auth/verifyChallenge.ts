import { users } from "@tearleads/api-shared/schema";
import {
  authChallengeSigningBytes,
  toFingerprint,
  verify,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { eq } from "drizzle-orm";
import type { ApiServiceRuntime } from "../runtime";

interface VerifyChallengeInput {
  fingerprint: string;
  ipAddress?: string | null | undefined;
  signature: number[];
}

interface VerifyChallengeResult {
  organizationId: string;
  token: string;
  userId: string;
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
  const challengeHex = await runtime.keyValueStore.getdel(
    `challenge:${input.fingerprint}`,
  );
  if (!challengeHex) {
    throw new VerifyChallengeError(
      "Challenge expired or not found",
      "challenge_not_found",
    );
  }

  const [user] = await runtime.db
    .select({
      defaultOrganizationId: users.defaultOrganizationId,
      id: users.id,
      signingPublicKey: users.signingPublicKey,
    })
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
    ipAddress: input.ipAddress,
  });

  return {
    organizationId: user.defaultOrganizationId,
    token,
    userId: user.id,
  };
}
