import { request } from "../../util/request";

export function postVerify(fingerprint: string, signature: Uint8Array) {
  return request("/auth/verify", {
    method: "POST",
    body: JSON.stringify({
      fingerprint,
      signature: Array.from(signature),
    }),
  });
}
