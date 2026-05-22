import {
  isDestroySessionResponse,
  isListSessionsResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export async function listSessions(request: RequestFn) {
  return request("/auth/sessions", isListSessionsResponse, "GET");
}

export async function destroySession(request: RequestFn, sessionId: string) {
  return request(
    `/auth/sessions/${encodeURIComponent(sessionId)}`,
    isDestroySessionResponse,
    "DELETE",
  );
}

export async function logout(request: RequestFn) {
  return request("/auth/logout", isDestroySessionResponse, "POST");
}
