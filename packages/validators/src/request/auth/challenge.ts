import { isPlainObject } from "../../isPlainObject";

export interface ChallengeRequest {
  fingerprint: string;
}

export function isChallengeRequest(value: unknown): value is ChallengeRequest {
  return isPlainObject(value) && typeof value["fingerprint"] === "string";
}
