import { app } from "../../../src/index";

export async function createDocument(
  token: string,
  linkedContainerIds: string[],
): Promise<Response> {
  return app.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ linkedContainerIds }),
  });
}
