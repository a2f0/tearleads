import { expect, test } from "bun:test";
import type {
  ChallengeRequest,
  HealthRequest,
  PublicKeyRequest,
  VerifyRequest,
} from "./index";

test("request types are importable", () => {
  const health: HealthRequest = {};
  const publicKey: PublicKeyRequest = { publicKey: [1, 2, 3] };
  const challenge: ChallengeRequest = { fingerprint: "abc" };
  const verify: VerifyRequest = { fingerprint: "abc", signature: [1, 2, 3] };

  expect(health).toBeDefined();
  expect(publicKey).toBeDefined();
  expect(challenge).toBeDefined();
  expect(verify).toBeDefined();
});
