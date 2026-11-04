import type { TargetName } from "./targets";

/** Where the CLI keeps one recovery key per target. */
export interface RecoveryKeyStore {
  read(target: TargetName): Promise<string | null>;
  remove(target: TargetName): Promise<boolean>;
  save(target: TargetName, recoveryKey: string): Promise<void>;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
}

/** Runs a command, writing `stdin` to it; secrets travel only on stdin. */
export type CommandRunner = (
  command: readonly string[],
  stdin?: string,
) => Promise<CommandResult>;

const KEYCHAIN_SERVICE = "com.tearleads.cli.recovery-key";
// `security` exits 44 when no item matches.
const KEYCHAIN_ITEM_NOT_FOUND = 44;

const runCommand: CommandRunner = async (command, stdin) => {
  const child = Bun.spawn([...command], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  return { exitCode, stdout };
};

/**
 * The macOS login Keychain, through `security`. Saving goes through
 * `security -i` so the key is read from stdin and never appears in a process
 * argument list.
 */
export function createKeychainRecoveryKeyStore(
  run: CommandRunner = runCommand,
): RecoveryKeyStore {
  return {
    async read(target) {
      const result = await run([
        "security",
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        target,
        "-w",
      ]);
      if (result.exitCode === KEYCHAIN_ITEM_NOT_FOUND) return null;
      if (result.exitCode !== 0) {
        throw new Error("Could not read the recovery key from the Keychain.");
      }
      return result.stdout.trim();
    },
    async remove(target) {
      const result = await run([
        "security",
        "delete-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        target,
      ]);
      if (result.exitCode === KEYCHAIN_ITEM_NOT_FOUND) return false;
      if (result.exitCode !== 0) {
        throw new Error("Could not remove the recovery key from the Keychain.");
      }
      return true;
    },
    async save(target, recoveryKey) {
      // Normalized keys hold only lowercase words and single spaces, so
      // double quotes delimit them safely.
      const result = await run(
        ["security", "-i"],
        `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${target} -w "${recoveryKey}"\n`,
      );
      // `security -i` can exit 0 after a failed command; read the item back.
      if (result.exitCode !== 0 || (await this.read(target)) !== recoveryKey) {
        throw new Error("Could not save the recovery key in the Keychain.");
      }
    },
  };
}
