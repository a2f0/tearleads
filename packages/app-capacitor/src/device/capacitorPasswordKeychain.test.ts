import { expect, mock, test } from "bun:test";
import {
  createCapacitorPasswordKeychain,
  type NativePasswordKeychainPlugin,
} from "./capacitorPasswordKeychain";

function keychainOver(plugin: Partial<NativePasswordKeychainPlugin>) {
  const native: NativePasswordKeychainPlugin = {
    pick: async () => ({}),
    save: async () => ({ outcome: "saved" }),
    ...plugin,
  };
  return createCapacitorPasswordKeychain(() => native);
}

test("saving passes the entry through and reports the native outcome", async () => {
  const save = mock(
    async (_options: { account: string; passphrase: string }) => ({
      outcome: "dismissed",
    }),
  );
  const keychain = keychainOver({ save });
  await expect(
    keychain.save({ account: "Identity 0123456789ab", passphrase: "a b c" }),
  ).resolves.toBe("dismissed");
  expect(save).toHaveBeenCalledWith({
    account: "Identity 0123456789ab",
    passphrase: "a b c",
  });
});

test("a device with no password manager is an outcome, not a failure", async () => {
  const keychain = keychainOver({
    save: async () => ({ outcome: "unavailable" }),
  });
  await expect(
    keychain.save({ account: "Identity 0123456789ab", passphrase: "a b c" }),
  ).resolves.toBe("unavailable");
});

test("an outcome the web layer does not know is a failure", async () => {
  const keychain = keychainOver({ save: async () => ({ outcome: "maybe" }) });
  await expect(
    keychain.save({ account: "Identity 0123456789ab", passphrase: "a b c" }),
  ).rejects.toThrow("unknown outcome");
});

test("picking returns the chosen passphrase, or null when none was chosen", async () => {
  await expect(
    keychainOver({ pick: async () => ({ passphrase: "a b c" }) }).pick(),
  ).resolves.toBe("a b c");
  for (const result of [{}, { passphrase: "" }, { passphrase: 7 }]) {
    await expect(
      keychainOver({ pick: async () => result }).pick(),
    ).resolves.toBeNull();
  }
});
