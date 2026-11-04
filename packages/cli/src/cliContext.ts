import type { RecoveryKeyStore } from "./recoveryKeyStore";
import type { TargetName } from "./targets";

/** Everything a command touches outside the SDK, so tests can supply it. */
export interface CliContext {
  apiBaseUrl(target: TargetName): string;
  readonly keyStore: RecoveryKeyStore;
  readRecoveryKey(prompt: string): Promise<string>;
  stderr(line: string): void;
  stdout(line: string): void;
}

export interface CommandInput {
  readonly context: CliContext;
  readonly organizationId: string | undefined;
  readonly target: TargetName;
}
