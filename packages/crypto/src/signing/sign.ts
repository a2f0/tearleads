import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";

export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ml_dsa87.sign(message, secretKey);
}
