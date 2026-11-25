import type { ApiClient, RequestResult } from "@tearleads/api-client";
import type { Session } from "../session/sessionTypes";
import {
  type TwoFactor,
  type TwoFactorAnswer,
  TwoFactorRequestError,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from "./twoFactorTypes";

export {
  type TwoFactor,
  type TwoFactorAnswer,
  TwoFactorRequestError,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from "./twoFactorTypes";

type TwoFactorApi = Pick<
  ApiClient,
  | "beginTwoFactorSetupResult"
  | "disableTwoFactorResult"
  | "enableTwoFactorResult"
  | "getTwoFactorStatusResult"
  | "regenerateTwoFactorRecoveryCodesResult"
>;

type TwoFactorSession = Pick<Session, "setContext" | "snapshot" | "subscribe">;

function dataOrThrow<T>(result: RequestResult<T>): T {
  if (result.ok) return result.data;
  throw new TwoFactorRequestError(
    result.message,
    result.code ?? null,
    result.status,
  );
}

/**
 * The last status known for the current session token. An answer to a
 * request made under an earlier token is never published for a later one.
 */
function createTwoFactorStatusStore(session: TwoFactorSession) {
  let current: TwoFactorStatus | null = null;
  let token = session.snapshot.authToken;
  const listeners = new Set<() => void>();
  const publish = (next: TwoFactorStatus | null) => {
    current = next;
    for (const listener of listeners) listener();
  };
  session.subscribe(() => {
    if (session.snapshot.authToken === token) return;
    token = session.snapshot.authToken;
    if (current !== null) publish(null);
  });
  return {
    get snapshot() {
      return current;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Runs `work` and publishes its status if the token did not change. */
    async track<T>(
      work: () => Promise<T>,
      next: (value: T, previous: TwoFactorStatus | null) => TwoFactorStatus,
    ): Promise<T> {
      const startedWith = session.snapshot.authToken;
      const value = await work();
      if (session.snapshot.authToken === startedWith) {
        publish(next(value, current));
      }
      return value;
    },
  };
}

/** The remembered-device token lives with the session the host persists. */
export function createTwoFactor(
  api: TwoFactorApi,
  session: TwoFactorSession,
): TwoFactor {
  const store = createTwoFactorStatusStore(session);
  return {
    get snapshot() {
      return store.snapshot;
    },
    subscribe: store.subscribe,
    async status(): Promise<TwoFactorStatus> {
      return store.track(
        async () => dataOrThrow(await api.getTwoFactorStatusResult()),
        (status) => status,
      );
    },
    async beginSetup(): Promise<TwoFactorSetup> {
      return dataOrThrow(await api.beginTwoFactorSetupResult());
    },
    async enable(code, options = {}) {
      const enabled = await store.track(
        async () =>
          dataOrThrow(
            await api.enableTwoFactorResult({
              code,
              rememberDevice: options.rememberDevice ?? false,
            }),
          ),
        ({ recoveryCodes }) => ({
          enabled: true,
          recoveryCodesRemaining: recoveryCodes.length,
          requiredByOrganizationIds: [],
          sessionVerified: true,
        }),
      );
      if (enabled.deviceToken) {
        session.setContext({ twoFactorDeviceToken: enabled.deviceToken });
      }
      return enabled.recoveryCodes;
    },
    async disable(answer: TwoFactorAnswer) {
      // The server signs this session out too; its renewal starts afresh.
      await store.track(
        async () =>
          dataOrThrow(await api.disableTwoFactorResult({ ...answer })),
        (status) => status,
      );
      session.setContext({ twoFactorDeviceToken: null });
    },
    async regenerateRecoveryCodes(answer: TwoFactorAnswer) {
      const replaced = await store.track(
        async () =>
          dataOrThrow(
            await api.regenerateTwoFactorRecoveryCodesResult({ ...answer }),
          ),
        ({ recoveryCodes }, previous) => ({
          enabled: true,
          recoveryCodesRemaining: recoveryCodes.length,
          requiredByOrganizationIds: [],
          sessionVerified: previous?.sessionVerified ?? true,
        }),
      );
      return replaced.recoveryCodes;
    },
  };
}
