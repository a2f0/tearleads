import { isChallengeRequest } from "@tearleads/validators/request";
import { isChallengeResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function postChallenge(request: RequestFn, fingerprint: string) {
  const body = { fingerprint };
  if (!isChallengeRequest(body)) {
    throw new Error("Invalid ChallengeRequest");
  }
  return request(
    "/auth/challenge",
    isChallengeResponse,
    "POST",
    JSON.stringify(body),
  );
}
