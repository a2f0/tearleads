import type { TargetName } from "./targets";

/** Where the CLI keeps one recovery key per target. */
export interface RecoveryKeyStore {
  read(target: TargetName): Promise<string | null>;
  remove(target: TargetName): Promise<boolean>;
  save(target: TargetName, recoveryKey: string): Promise<void>;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
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
// A non-secret value for the diagnostic write a failed save runs.
const PROBE_PASSWORD = "tearleads-cli-probe";

const runCommand: CommandRunner = async (command, stdin) => {
  const child = Bun.spawn([...command], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stderr, stdout };
};

/**
 * What `security` said about a failure, on one line, with `secret` removed
 * wherever it appears.
 */
function describeFailure(result: CommandResult, secret?: string): string {
  let text = result.stderr;
  if (secret) text = text.split(secret).join("[recovery key]");
  text = text.replace(/\s+/gu, " ").trim();
  return text.length > 0
    ? `security exited ${result.exitCode}: ${text}`
    : `security exited ${result.exitCode} without an error message`;
}

/**
 * The macOS login Keychain, through `security`. Saving goes through
 * `security -i` so the key is read from stdin and never appears in a process
 * argument list. `security -i` reports success even when its command fails,
 * so a failed save repeats the write non-interactively with a throwaway
 * value to learn macOS's reason, then deletes that entry.
 */
export function createKeychainRecoveryKeyStore(
  run: CommandRunner = runCommand,
): RecoveryKeyStore {
  const item = (target: TargetName) => ["-s", KEYCHAIN_SERVICE, "-a", target];

  async function diagnoseSaveFailure(
    target: TargetName,
    interactive: CommandResult,
    recoveryKey: string,
  ): Promise<string> {
    const probeAccount = `${target}.probe`;
    const probe = await run([
      "security",
      "add-generic-password",
      "-U",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      probeAccount,
      "-w",
      PROBE_PASSWORD,
    ]);
    await run([
      "security",
      "delete-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      probeAccount,
    ]);
    if (probe.exitCode !== 0) {
      return `${describeFailure(probe)}. If this terminal runs inside tmux, screen, or SSH, run \`security unlock-keychain\` or use a Terminal window in your desktop session`;
    }
    if (interactive.exitCode !== 0 || interactive.stderr.trim().length > 0) {
      return describeFailure(interactive, recoveryKey);
    }
    return "the Keychain accepted a test entry, but the recovery key did not read back";
  }

  return {
    async read(target) {
      const result = await run([
        "security",
        "find-generic-password",
        ...item(target),
        "-w",
      ]);
      if (result.exitCode === KEYCHAIN_ITEM_NOT_FOUND) return null;
      if (result.exitCode !== 0) {
        throw new Error(
          `Could not read the recovery key from the Keychain (${describeFailure(result)}).`,
        );
      }
      return result.stdout.trim();
    },
    async remove(target) {
      const result = await run([
        "security",
        "delete-generic-password",
        ...item(target),
      ]);
      if (result.exitCode === KEYCHAIN_ITEM_NOT_FOUND) return false;
      if (result.exitCode !== 0) {
        throw new Error(
          `Could not remove the recovery key from the Keychain (${describeFailure(result)}).`,
        );
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
      const saved = await this.read(target).catch(() => null);
      if (result.exitCode === 0 && saved === recoveryKey) return;
      const reason = await diagnoseSaveFailure(target, result, recoveryKey);
      throw new Error(
        `Could not save the recovery key in the Keychain: ${reason}.`,
      );
    },
  };
}
