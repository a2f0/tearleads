import { isRecord } from "../../isRecord";

export interface ChallengeResponse {
  challenge: string;
}

export function isChallengeResponse(
  value: unknown,
): value is ChallengeResponse {
  return isRecord(value) && typeof value["challenge"] === "string";
}

export interface ChallengeErrorResponse {
  error: string;
}

export function isChallengeErrorResponse(
  value: unknown,
): value is ChallengeErrorResponse {
  return isRecord(value) && typeof value["error"] === "string";
}
