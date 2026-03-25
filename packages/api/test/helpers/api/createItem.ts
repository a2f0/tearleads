import { app } from "../../../src/index";

export async function createItem(
  payload: string,
  encryptedData: string,
  spicedbZedToken: string,
  token: string,
): Promise<Response> {
  return app.request("/items", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ payload, encryptedData, spicedbZedToken }),
  });
}
