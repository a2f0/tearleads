import { request } from "../../util/request";

export function postChallenge(fingerprint: string) {
  return request("/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ fingerprint }),
  });
}
