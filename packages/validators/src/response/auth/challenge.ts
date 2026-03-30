import { isPlainObject } from "../../isPlainObject";
import { hasStringProperty } from "../../util";

export interface ChallengeResponse {
  challenge: string;
}

export function isChallengeResponse(
  value: unknown,
): value is ChallengeResponse {
  return isPlainObject(value) && hasStringProperty(value, "challenge");
}

export interface ChallengeErrorResponse {
  error: string;
}

export function isChallengeErrorResponse(
  value: unknown,
): value is ChallengeErrorResponse {
  return isPlainObject(value) && hasStringProperty(value, "error");
}
