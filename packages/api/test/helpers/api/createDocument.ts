import { app } from "../../../src/index";

export async function createDocument(token: string): Promise<Response> {
  return app.request("/documents", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}
