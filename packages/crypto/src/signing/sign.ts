import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import { ML_DSA87_SECRET_KEY_BYTES } from "./generateKeyPair";

export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  if (secretKey.length !== ML_DSA87_SECRET_KEY_BYTES) {
    throw new Error("ML-DSA-87 signing requires a 4896-byte secret key");
  }

  return ml_dsa87.sign(message, secretKey);
}
