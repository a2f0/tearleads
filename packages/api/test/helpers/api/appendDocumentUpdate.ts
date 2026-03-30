import { app } from "../../../src/index";

export async function appendDocumentUpdate(
  documentId: string,
  encryptedData: string,
  token: string,
): Promise<Response> {
  return app.request(`/documents/${documentId}/updates`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ encryptedData }),
  });
}
