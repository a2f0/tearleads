import { isChallengeRequest } from "@tearleads/validators/request";
import type { ChallengeResponse } from "@tearleads/validators/response";
import { request } from "../../util/request";

export function postChallenge(fingerprint: string) {
  const body = { fingerprint };
  if (!isChallengeRequest(body)) {
    throw new Error("Invalid ChallengeRequest");
  }
  return request<ChallengeResponse>("/auth/challenge", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
