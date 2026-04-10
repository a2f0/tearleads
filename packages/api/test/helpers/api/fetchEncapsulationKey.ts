import { routeApp } from "../../../src/routeApp";

export async function fetchEncapsulationKey(
  userId: string,
  token: string,
): Promise<Response> {
  return routeApp.request(`/auth/encapsulation-key/${userId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}
