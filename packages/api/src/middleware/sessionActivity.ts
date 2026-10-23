import type { SessionData } from "../validators/session";
import type { UserActivityRecorder } from "./userActivity";

const SESSION_ACTIVITY_UPDATE_INTERVAL_MS = 60000;
const MAX_SESSION_IP_ADDRESSES = 64;

export function withSessionActivity(
  session: SessionData,
  ipAddress: string | null,
  lastActiveAt: number,
): SessionData {
  const nextIpAddresses =
    ipAddress && !session.ipAddresses.includes(ipAddress)
      ? [...session.ipAddresses, ipAddress].slice(-MAX_SESSION_IP_ADDRESSES)
      : session.ipAddresses;

  return {
    ...session,
    ipAddresses: nextIpAddresses,
    lastActiveAt,
    lastActiveIp: ipAddress ?? session.lastActiveIp,
  };
}

export function shouldUpdateSessionActivity(
  session: SessionData,
  ipAddress: string | null,
  now: number,
): boolean {
  return (
    now - session.lastActiveAt >= SESSION_ACTIVITY_UPDATE_INTERVAL_MS ||
    (ipAddress !== null &&
      (session.lastActiveIp !== ipAddress ||
        !session.ipAddresses.includes(ipAddress)))
  );
}

/** Best-effort: activity metadata failures are logged, never surfaced. */
export async function persistSessionActivity(input: {
  readonly key: string;
  readonly now: number;
  readonly recordUserActivity: UserActivityRecorder | undefined;
  readonly session: SessionData;
  readonly setSessionKeepTtl: (key: string, value: string) => Promise<void>;
}): Promise<void> {
  try {
    await input.setSessionKeepTtl(input.key, JSON.stringify(input.session));
  } catch (error) {
    console.error("Failed to update session activity metadata:", error);
  }
  if (input.recordUserActivity) {
    try {
      await input.recordUserActivity({
        lastActiveAt: input.now,
        userId: input.session.userId,
      });
    } catch (error) {
      console.error("Failed to record user activity:", error);
    }
  }
}
