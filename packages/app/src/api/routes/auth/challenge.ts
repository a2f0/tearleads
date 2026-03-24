import type { ChallengeRequest } from "@tearleads/validators/request";
import type { ChallengeResponse } from "@tearleads/validators/response";
import { request } from "../../util/request";

export function postChallenge(fingerprint: string) {
  const body: ChallengeRequest = { fingerprint };
  return request<ChallengeResponse>("/auth/challenge", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
