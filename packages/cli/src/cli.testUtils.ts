import type { CliContext } from "./cliContext";
import type { RecoveryKeyStore } from "./recoveryKeyStore";

function memoryRecoveryKeyStore(): RecoveryKeyStore & {
  readonly items: Map<string, string>;
} {
  const items = new Map<string, string>();
  return {
    items,
    read: async (target) => items.get(target) ?? null,
    remove: async (target) => items.delete(target),
    save: async (target, recoveryKey) => {
      items.set(target, recoveryKey);
    },
  };
}

export function testContext(
  options: { readonly apiBaseUrl?: string; readonly recoveryKey?: string } = {},
) {
  const output: { stderr: string[]; stdout: string[] } = {
    stderr: [],
    stdout: [],
  };
  const keyStore = memoryRecoveryKeyStore();
  const context: CliContext = {
    apiBaseUrl: () => options.apiBaseUrl ?? "http://127.0.0.1:9",
    keyStore,
    readRecoveryKey: async () => {
      if (options.recoveryKey === undefined) {
        throw new Error("no recovery key supplied");
      }
      return options.recoveryKey;
    },
    stderr: (line) => output.stderr.push(line),
    stdout: (line) => output.stdout.push(line),
  };
  return { context, keyStore, output };
}
