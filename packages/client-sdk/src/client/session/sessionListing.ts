import type { ApiClient } from "@tearleads/api-client";
import type { UserSession } from "./sessionTypes";

/** Projects the server's session listing onto the public SDK shape. */
export function userSessionsFromResponse(
  response: Awaited<ReturnType<ApiClient["listSessions"]>>,
): UserSession[] {
  if (!response) {
    return [];
  }
  return response.sessions.map(
    ({
      createdAt,
      id,
      ipAddresses,
      isCurrent,
      lastActiveAt,
      lastActiveIp,
      signingKeyFingerprint,
    }) => ({
      createdAt,
      id,
      ipAddresses,
      isCurrent,
      lastActiveAt,
      lastActiveIp,
      signingKeyFingerprint,
    }),
  );
}
