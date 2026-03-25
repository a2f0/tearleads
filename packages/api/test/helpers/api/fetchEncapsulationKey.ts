import { app } from "../../../src/index";

export async function fetchEncapsulationKey(
  userId: string,
  token: string,
): Promise<Response> {
  return app.request(`/auth/encapsulation-key/${userId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}
