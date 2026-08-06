import { expect, test } from "bun:test";
import {
  destroySessionOperation,
  listSessionsOperation,
  logoutOperation,
  userIdentityOperation,
  webSocketTicketOperation,
} from "@tearleads/validators/operation";
import {
  destroySession,
  listSessions,
  logout,
  userIdentity,
  webSocketTicket,
} from "./session";

test("auth client routes derive paths and methods from shared operations", () => {
  const sessionId = "a".repeat(64);

  expect(destroySession.method).toBe(destroySessionOperation.method);
  expect(destroySession.path(sessionId)).toBe(`/auth/sessions/${sessionId}`);
  expect(listSessions).toMatchObject({
    method: listSessionsOperation.method,
    path: "/auth/sessions",
  });
  expect(logout).toMatchObject({
    method: logoutOperation.method,
    path: "/auth/logout",
  });
  expect(userIdentity.method).toBe(userIdentityOperation.method);
  expect(userIdentity.path("user/id")).toBe("/auth/user-identity/user%2Fid");
  expect(webSocketTicket).toMatchObject({
    method: webSocketTicketOperation.method,
    path: "/auth/ws-ticket",
  });
});
