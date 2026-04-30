import { isPlainObject } from "../../isPlainObject";
import { hasStringProperty, isSha256HexString } from "../../util";

export interface ChallengeRequest {
  fingerprint: string;
}

export function isChallengeRequest(value: unknown): value is ChallengeRequest {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "fingerprint") &&
    isSha256HexString(value.fingerprint)
  );
}
