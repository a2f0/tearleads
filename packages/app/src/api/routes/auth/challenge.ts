import { isChallengeRequest } from "@tearleads/validators/request";
import { isChallengeResponse } from "@tearleads/validators/response";
import { request } from "../../util/request";

export function postChallenge(fingerprint: string) {
  const body = { fingerprint };
  if (!isChallengeRequest(body)) {
    throw new Error("Invalid ChallengeRequest");
  }
  return request("/auth/challenge", isChallengeResponse, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
