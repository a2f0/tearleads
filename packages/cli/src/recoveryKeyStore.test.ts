import { expect, test } from "bun:test";
import {
  type CommandResult,
  type CommandRunner,
  createKeychainRecoveryKeyStore,
} from "./recoveryKeyStore";

const KEY = "abandon ability able";
const LOCKED =
  "security: SecKeychainItemCreateFromContent (<default>): User interaction is not allowed.";

interface FakeKeychainOptions {
  /** Every write fails; `security -i` still exits 0, as it does on macOS. */
  readonly locked?: boolean;
  /** `security -i` drops the write and prints this on stderr. */
  readonly interactiveStderr?: string;
}

function fakeKeychain(options: FakeKeychainOptions = {}) {
  const items = new Map<string, string>();
  const calls: { command: readonly string[]; stdin: string | undefined }[] = [];
  const result = (
    exitCode: number,
    stdout = "",
    stderr = "",
  ): CommandResult => ({
    exitCode,
    stderr,
    stdout,
  });
  const run: CommandRunner = async (command, stdin) => {
    calls.push({ command, stdin });
    const account = command[command.indexOf("-a") + 1] ?? "";
    switch (command[1]) {
      case "find-generic-password": {
        const value = items.get(account);
        return value === undefined ? result(44) : result(0, `${value}\n`);
      }
      case "delete-generic-password":
        return items.delete(account) ? result(0) : result(44);
      case "add-generic-password": {
        if (options.locked) return result(152, "", LOCKED);
        items.set(account, command[command.indexOf("-w") + 1] ?? "");
        return result(0);
      }
      case "-i": {
        if (options.locked) return result(0, "", LOCKED);
        if (options.interactiveStderr !== undefined) {
          return result(0, "", options.interactiveStderr);
        }
        const match = /-a (\S+) -w "([^"]*)"\n$/u.exec(stdin ?? "");
        if (match?.[1] && match[2] !== undefined) {
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

test("a failed save reports macOS's reason from a throwaway probe write", async () => {
  const keychain = fakeKeychain({ locked: true });

  const error = await keychain.store
    .save("production", KEY)
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  const message = error instanceof Error ? error.message : "";
  expect(message).toContain(
    "Could not save the recovery key in the Keychain: security exited 152:",
  );
  expect(message).toContain("User interaction is not allowed.");
  expect(message).toContain("security unlock-keychain");
  expect(message).not.toContain("abandon");
  // The probe carries no secret and leaves nothing behind.
  const probe = keychain.calls.find(
    ({ command }) => command[1] === "add-generic-password",
  );
  expect(probe?.command).toContain("production.probe");
  expect(probe?.command.join(" ")).not.toContain("abandon");
  expect(keychain.items.size).toBe(0);
});

test("security's own output is shown with the recovery key removed", async () => {
  const keychain = fakeKeychain({
    interactiveStderr: `add-generic-password: rejected "${KEY}"\n`,
  });

  const error = await keychain.store
    .save("production", KEY)
    .catch((caught: unknown) => caught);
  const message = error instanceof Error ? error.message : "";
  expect(message).toContain(
    'security exited 0: add-generic-password: rejected "[recovery key]"',
  );
  expect(message).not.toContain("abandon");
  expect(keychain.items.has("production.probe")).toBe(false);
});

test("a silent dropped save says the Keychain itself accepts writes", async () => {
  const keychain = fakeKeychain({ interactiveStderr: "" });

  const error = await keychain.store
    .save("production", KEY)
    .catch((caught: unknown) => caught);
  const message = error instanceof Error ? error.message : "";
  expect(message).toBe(
    "Could not save the recovery key in the Keychain: the Keychain accepted a test entry, but the recovery key did not read back.",
  );
});

test("keys are kept per target", async () => {
  const keychain = fakeKeychain();
  await keychain.store.save("staging", KEY);

  expect(await keychain.store.read("production")).toBeNull();
});
