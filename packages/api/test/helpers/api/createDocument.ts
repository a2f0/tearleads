import { routeApp } from "../../../src/routeApp";

export async function createDocument(
  token: string,
  linkedContainerIds: string[],
): Promise<Response> {
  return routeApp.request("/documents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ linkedContainerIds }),
  });
}
