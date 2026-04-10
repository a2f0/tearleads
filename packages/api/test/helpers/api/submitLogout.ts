import { routeApp } from "../../../src/routeApp";

export async function submitLogout(token: string): Promise<Response> {
  return routeApp.request("/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}
