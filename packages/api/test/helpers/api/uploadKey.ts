import { app } from "../../../src/index";

export async function uploadKey(
  signingPublicKey: Uint8Array,
  encapsulationPublicKey: Uint8Array,
): Promise<Response> {
  return app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      signingPublicKey: Array.from(signingPublicKey),
      encapsulationPublicKey: Array.from(encapsulationPublicKey),
    }),
  });
}
