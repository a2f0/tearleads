import { app } from "../../../src/index";

export async function uploadKey(publicKey: Uint8Array): Promise<Response> {
  return app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: Array.from(publicKey) }),
  });
}
