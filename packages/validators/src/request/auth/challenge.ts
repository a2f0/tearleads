import { isRecord } from "../../isRecord";

export interface ChallengeRequest {
  fingerprint: string;
}

export function isChallengeRequest(value: unknown): value is ChallengeRequest {
  return isRecord(value) && typeof value["fingerprint"] === "string";
}
