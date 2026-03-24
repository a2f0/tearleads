import { isPlainObject } from "../../isPlainObject";

export interface ChallengeResponse {
  challenge: string;
}

export function isChallengeResponse(
  value: unknown,
): value is ChallengeResponse {
  return isPlainObject(value) && typeof value["challenge"] === "string";
}

export interface ChallengeErrorResponse {
  error: string;
}

export function isChallengeErrorResponse(
  value: unknown,
): value is ChallengeErrorResponse {
  return isPlainObject(value) && typeof value["error"] === "string";
}
