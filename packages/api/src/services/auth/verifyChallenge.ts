import { hexToBytes, verify } from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import type { VerifyResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { users } from "../../schema";
import type { ApiServiceRuntime } from "../runtime";

interface VerifyChallengeInput {
  fingerprint: string;
  signature: number[];
}

interface VerifyChallengeResult {
  body: VerifyResponse;
  status: 200 | 401 | 404;
}

export async function verifyChallenge(
  runtime: ApiServiceRuntime,
  input: VerifyChallengeInput,
): Promise<VerifyChallengeResult> {
  const challengeHex = await runtime.keyValueStore.get(
    `challenge:${input.fingerprint}`,
  );
  if (!challengeHex) {
    return {
      body: {
        error: "Challenge expired or not found",
        authenticated: false,
      },
      status: 401,
    };
  }

  await runtime.keyValueStore.del(`challenge:${input.fingerprint}`);

  const storedKey = await runtime.keyValueStore.get(input.fingerprint);
  if (!storedKey) {
    return {
      body: {
        error: "Unknown fingerprint",
        authenticated: false,
      },
      status: 404,
    };
  }

  const publicKey = base64ToBytes(storedKey);
  const challengeBytes = hexToBytes(challengeHex);
  const signatureBytes = new Uint8Array(input.signature);

  if (!verify(signatureBytes, challengeBytes, publicKey)) {
    return {
      body: {
        authenticated: false,
        error: "Invalid signature",
      },
      status: 401,
    };
  }

  const [user] = await runtime.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.fingerprint, input.fingerprint))
    .limit(1);

  if (!user) {
    return {
      body: {
        error: "Unknown fingerprint",
        authenticated: false,
      },
      status: 404,
    };
  }

  const token = await runtime.sessionTokenIssuer.createSession({
    userId: user.id,
    fingerprint: input.fingerprint,
    createdAt: Date.now(),
  });

  return {
    body: {
      authenticated: true,
      token,
    },
    status: 200,
  };
}
