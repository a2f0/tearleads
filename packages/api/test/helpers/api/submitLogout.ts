import { app } from "../../../src/index";

export async function submitLogout(sessionCookie: string): Promise<Response> {
  return app.request("/auth/logout", {
    method: "POST",
    headers: { Cookie: sessionCookie },
  });
}
