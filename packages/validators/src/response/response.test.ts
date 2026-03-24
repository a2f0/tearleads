import { expect, test } from "bun:test";
import type {
  ChallengeErrorResponse,
  ChallengeResponse,
  HealthResponse,
  PublicKeyResponse,
  VerifyResponse,
} from "./index";

test("response types are importable", () => {
  const health: HealthResponse = { message: "ok" };
  const publicKey: PublicKeyResponse = { message: "ok" };
  const challenge: ChallengeResponse = { challenge: "abc" };
  const challengeError: ChallengeErrorResponse = { error: "not found" };
  const verify: VerifyResponse = { authenticated: true };

  expect(health).toBeDefined();
  expect(publicKey).toBeDefined();
  expect(challenge).toBeDefined();
  expect(challengeError).toBeDefined();
  expect(verify).toBeDefined();
});
