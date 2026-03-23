import { request } from "../util/request";

export function postPublicKey(publicKey: Uint8Array) {
  return request("/publicKey", {
    method: "POST",
    body: JSON.stringify({ publicKey: Array.from(publicKey) }),
  });
}
