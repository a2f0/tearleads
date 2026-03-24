import { app } from "../../../src/index";

export async function submitLogout(token: string): Promise<Response> {
  return app.request("/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}
