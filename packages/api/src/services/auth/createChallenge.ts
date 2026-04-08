import {
  bytesToHex,
  CHALLENGE_TTL_SECONDS,
  generateChallenge,
} from "@tearleads/crypto";
import type {
  ChallengeErrorResponse,
  ChallengeResponse,
} from "@tearleads/validators/response";
import type { ApiServiceRuntime } from "../runtime";

interface CreateChallengeInput {
  fingerprint: string;
}

interface CreateChallengeResult {
  body: ChallengeErrorResponse | ChallengeResponse;
  status: 200 | 404;
}

export async function createChallenge(
  runtime: ApiServiceRuntime,
  input: CreateChallengeInput,
): Promise<CreateChallengeResult> {
  const storedKey = await runtime.keyValueStore.get(input.fingerprint);
  if (!storedKey) {
    return {
      body: { error: "Unknown fingerprint" },
      status: 404,
    };
  }

  const bytes = generateChallenge();
  const challengeHex = bytesToHex(bytes);
  await runtime.keyValueStore.set(
    `challenge:${input.fingerprint}`,
    challengeHex,
    CHALLENGE_TTL_SECONDS,
  );

  return {
    body: { challenge: challengeHex },
    status: 200,
  };
}
