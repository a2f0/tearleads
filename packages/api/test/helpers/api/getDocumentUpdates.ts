import { app } from "../../../src/index";

export async function getDocumentUpdates(
  documentId: string,
  token: string,
  since?: number,
): Promise<Response> {
  const query = since === undefined ? "" : `?since=${since}`;

  return app.request(`/documents/${documentId}/updates${query}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}
