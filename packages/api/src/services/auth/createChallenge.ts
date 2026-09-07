import { users } from "@tearleads/api-shared/schema";
import {
  bytesToHex,
  CHALLENGE_TTL_SECONDS,
  generateChallenge,
} from "@tearleads/crypto";
import { eq } from "drizzle-orm";
import type { ApiServiceRuntime } from "../runtime";

interface CreateChallengeInput {
  fingerprint: string;
}

interface CreateChallengeResult {
  challenge: string;
}

type CreateChallengeErrorReason = "unknown_fingerprint";

export class CreateChallengeError extends Error {
  constructor(
    message: string,
    readonly reason: CreateChallengeErrorReason,
  ) {
    super(message);
  }
}

export async function createChallenge(
  runtime: ApiServiceRuntime,
  input: CreateChallengeInput,
): Promise<CreateChallengeResult> {
  const [user] = await runtime.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.fingerprint, input.fingerprint))
    .limit(1);
  if (!user) {
    throw new CreateChallengeError(
      "Unknown fingerprint",
      "unknown_fingerprint",
    );
  }

  const bytes = generateChallenge();
  const challengeHex = bytesToHex(bytes);
  await runtime.keyValueStore.set(
    `challenge:${input.fingerprint}`,
    challengeHex,
    CHALLENGE_TTL_SECONDS,
  );

  return {
    challenge: challengeHex,
  };
}
