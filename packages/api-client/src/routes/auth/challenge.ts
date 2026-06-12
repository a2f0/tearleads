import { isChallengeResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function getChallenge(request: RequestFn, fingerprint: string) {
  return request(
    "/auth/challenge",
    isChallengeResponse,
    "POST",
    JSON.stringify({ fingerprint }),
    { retryOnSessionExpired: false },
  );
}
