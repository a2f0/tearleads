import { expect, test } from "bun:test";
import {
  type CommandResult,
  type CommandRunner,
  createKeychainRecoveryKeyStore,
} from "./recoveryKeyStore";

const KEY = "abandon ability able";

function fakeKeychain(options: { readonly saveSucceeds?: boolean } = {}) {
  const items = new Map<string, string>();
  const calls: { command: readonly string[]; stdin: string | undefined }[] = [];
  const run: CommandRunner = async (command, stdin) => {
    calls.push({ command, stdin });
    const account = command[command.indexOf("-a") + 1] ?? "";
    const result = (exitCode: number, stdout = ""): CommandResult => ({
      exitCode,
      stdout,
    });
    switch (command[1]) {
      case "find-generic-password": {
        const value = items.get(account);
        return value === undefined ? result(44) : result(0, `${value}\n`);
      }
      case "delete-generic-password":
        return items.delete(account) ? result(0) : result(44);
      case "-i": {
        const match = /-a (\S+) -w "([^"]*)"\n$/u.exec(stdin ?? "");
        if (
          match?.[1] &&
          match[2] !== undefined &&
          options.saveSucceeds !== false
        ) {
          items.set(match[1], match[2]);
        }
        return result(0);
      }
      default:
        return result(1);
    }
  };
  return { calls, items, store: createKeychainRecoveryKeyStore(run) };
}

test("saving passes the key on stdin, never in an argument", async () => {
  const keychain = fakeKeychain();
  await keychain.store.save("production", KEY);

  expect(await keychain.store.read("production")).toBe(KEY);
  for (const { command } of keychain.calls) {
    expect(command.join(" ")).not.toContain("abandon");
  }
  expect(keychain.calls[0]?.stdin).toContain(`-a production -w "${KEY}"`);
});

test("reading or removing a missing key reports its absence", async () => {
  const keychain = fakeKeychain();

  expect(await keychain.store.read("staging")).toBeNull();
  expect(await keychain.store.remove("staging")).toBe(false);
  await keychain.store.save("staging", KEY);
  expect(await keychain.store.remove("staging")).toBe(true);
  expect(await keychain.store.read("staging")).toBeNull();
});

test("a save the Keychain did not keep fails", async () => {
  const keychain = fakeKeychain({ saveSucceeds: false });

  await expect(keychain.store.save("production", KEY)).rejects.toThrow(
    "Could not save the recovery key",
  );
});

test("keys are kept per target", async () => {
  const keychain = fakeKeychain();
  await keychain.store.save("staging", KEY);

  expect(await keychain.store.read("production")).toBeNull();
});
