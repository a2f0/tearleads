import { get, setKeepTtl } from "../adapters/keyValueStore";
import {
  type SessionTwoFactorStanding,
  sessionTwoFactorStanding,
} from "../validators/session";
import { parseSessionData, sessionKey } from "./session";

type SessionStoreGet = (key: string) => Promise<string | null>;
type SessionStoreSetKeepTtl = (key: string, value: string) => Promise<void>;

export type UpdateSessionTwoFactorStanding = (input: {
  readonly sessionToken: string;
  readonly standing: SessionTwoFactorStanding;
}) => Promise<boolean>;

/**
 * Rewrites one live session's two-factor standing and keeps its expiry; false
 * when the session is gone. Turning two-factor on marks the calling session
 * as having passed it. A concurrent activity write can restore the earlier,
 * unverified standing; that only refuses more. The session is then refused,
 * and the device signs in again with a code unless it remembers one.
 */
function createUpdateSessionTwoFactorStanding(
  getSession: SessionStoreGet,
  setSessionKeepTtl: SessionStoreSetKeepTtl,
): UpdateSessionTwoFactorStanding {
  return async ({ sessionToken, standing }) => {
    const key = sessionKey(sessionToken);
    const raw = await getSession(key);
    const session = raw === null ? null : parseSessionData(raw);
    if (!session) return false;
    await setSessionKeepTtl(
      key,
      JSON.stringify({ ...session, ...sessionTwoFactorStanding(standing) }),
    );
    return true;
  };
}

export const updateSessionTwoFactorStanding =
  createUpdateSessionTwoFactorStanding(get, setKeepTtl);
