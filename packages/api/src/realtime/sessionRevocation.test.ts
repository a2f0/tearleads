import { expect, mock, test } from "bun:test";
import type { SessionData } from "../validators/session";
import { createSessionRevocationNotifier } from "./sessionRevocation";

const session: SessionData = {
  createdAt: 1,
  fingerprint: "f".repeat(64),
  id: "a".repeat(64),
  ipAddresses: [],
  lastActiveAt: 1,
  lastActiveIp: null,
  userId: "11111111-1111-4111-8111-111111111111",
};

test("publishes the revoked session for its sockets to close", async () => {
  const publishEvent = mock(async () => {});
  const notifySessionRevoked = createSessionRevocationNotifier({
    publishEvent,
  });

  await notifySessionRevoked(session);

  expect(publishEvent).toHaveBeenCalledTimes(1);
  expect(publishEvent).toHaveBeenCalledWith({
    sessionId: session.id,
    type: "session_revoked",
    userId: session.userId,
  });
});
