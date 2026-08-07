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

test("publishes session revocation when interest cleanup fails", async () => {
  const clearError = new Error("redis timeout");
  const clearInterest = mock(async () => {
    throw clearError;
  });
  const onClearInterestError = mock(() => {});
  const publishEvent = mock(async () => {});
  const notifySessionRevoked = createSessionRevocationNotifier({
    clearInterest,
    onClearInterestError,
    publishEvent,
  });

  await notifySessionRevoked(session);

  expect(clearInterest).toHaveBeenCalledWith(session.userId, session.id);
  expect(onClearInterestError).toHaveBeenCalledWith(clearError);
  expect(publishEvent).toHaveBeenCalledWith({
    sessionId: session.id,
    type: "session_revoked",
    userId: session.userId,
  });
});
