import {
  PROBE_PASSWORD,
  RECOVERY_KEY_SERVICE,
  type RecoveryKeyStore,
} from "./recoveryKeyStore";
import type { TargetName } from "./targets";

interface SecretItem {
  readonly name: string;
  readonly service: string;
}

/** The part of `Bun.secrets` the keyring store uses. */
export interface SecretsApi {
  delete(item: SecretItem): Promise<boolean>;
  get(item: SecretItem): Promise<string | null>;
  set(item: SecretItem & { readonly value: string }): Promise<void>;
}

const UNLOCK_HINT =
  "tearleads keeps recovery keys in the desktop keyring (GNOME Keyring or another Secret Service), which logging in to the desktop unlocks; run it from a terminal in that session";

/** The keyring's reason on one line, with `secret` removed wherever it appears. */
function describeFailure(error: unknown, secret?: string): string {
  let text = error instanceof Error ? error.message : String(error);
  if (secret) text = text.split(secret).join("[recovery key]");
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * The Linux desktop keyring, through the Secret Service (`Bun.secrets` over
 * libsecret). A locked keyring that cannot prompt answers a lookup with
 * nothing and a delete with false, as if no key were saved, so either answer
 * is confirmed with a throwaway write, which a locked keyring refuses.
 */
export function createSecretServiceRecoveryKeyStore(
  secrets: SecretsApi = Bun.secrets,
): RecoveryKeyStore {
  const item = (target: TargetName): SecretItem => ({
    name: target,
    service: RECOVERY_KEY_SERVICE,
  });

  async function attempt<T>(
    failure: string,
    work: () => Promise<T>,
    secret?: string,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw new Error(
        `Could not ${failure} (${describeFailure(error, secret)}). ${UNLOCK_HINT}.`,
      );
    }
  }

  /** Throws unless the keyring takes a write, so an empty answer is true. */
  async function confirmUnlocked(target: TargetName, failure: string) {
    const probe = { ...item(target), name: `${target}.probe` };
    await attempt(`${failure}, which refused a test write`, () =>
      secrets.set({ ...probe, value: PROBE_PASSWORD }),
    );
    await attempt(failure, () => secrets.delete(probe));
  }

  return {
    label: "the keyring",
    async read(target) {
      const failure = "read the recovery key from the keyring";
      const recoveryKey = await attempt(failure, () =>
        secrets.get(item(target)),
      );
      if (recoveryKey === null) await confirmUnlocked(target, failure);
      return recoveryKey;
    },
    async remove(target) {
      const failure = "remove the recovery key from the keyring";
      const removed = await attempt(failure, () =>
        secrets.delete(item(target)),
      );
      if (!removed) await confirmUnlocked(target, failure);
      return removed;
    },
    async save(target, recoveryKey) {
      const failure = "save the recovery key in the keyring";
      await attempt(
        failure,
        () => secrets.set({ ...item(target), value: recoveryKey }),
        recoveryKey,
      );
      const saved = await attempt(failure, () => secrets.get(item(target)));
      if (saved !== recoveryKey) {
        throw new Error(
          `Could not ${failure}: the keyring accepted it, but it did not read back.`,
        );
      }
    },
  };
}
