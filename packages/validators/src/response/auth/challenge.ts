import { isPlainObject } from "../../isPlainObject";
import { hasStringProperty, isAuthChallengeHexString } from "../../util";

export interface ChallengeResponse {
  challenge: string;
}

export function isChallengeResponse(
  value: unknown,
): value is ChallengeResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "challenge") &&
    isAuthChallengeHexString(value.challenge)
  );
}

export interface ChallengeErrorResponse {
  error: string;
}

export function isChallengeErrorResponse(
  value: unknown,
): value is ChallengeErrorResponse {
  return isPlainObject(value) && hasStringProperty(value, "error");
}
