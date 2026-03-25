import { app } from "../../../src/index";

export async function getItem(
  itemId: string,
  token: string,
): Promise<Response> {
  return app.request(`/items/${itemId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}
