import { routeApp } from "../../../src/routeApp";

export async function fetchUserIdentity(
  userId: string,
  token: string,
): Promise<Response> {
  return routeApp.request(`/auth/user-identity/${userId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}
