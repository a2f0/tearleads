import type { RecoveryKeyStore } from "./recoveryKeyStore";
import type { RegisterSeedShutdown } from "./seedCommandLifetime";
import type { TargetName } from "./targets";
import type { Tracer } from "./trace";

/** Everything a command touches outside the SDK, so tests can supply it. */
export interface CliContext {
  readonly registerShutdown?: RegisterSeedShutdown;
  apiBaseUrl(target: TargetName): string;
  readonly keyStore: RecoveryKeyStore;
  readRecoveryKey(prompt: string): Promise<string>;
  stderr(line: string): void;
  stdout(line: string): void;
  /** Turns on `--trace` without the flag (TEARLEADS_TRACE=1). */
  readonly traceByDefault?: boolean;
}

export interface CommandInput {
  /** `--api-url`: an API to use in place of the target's. */
  readonly apiUrl?: string | undefined;
  readonly context: CliContext;
  readonly keyFromStdin?: boolean;
  readonly organizationId: string | undefined;
  /** `seed --roster`: also seed the dataset's groups and their members. */
  readonly roster?: boolean;
  readonly target: TargetName;
  readonly tracer: Tracer;
}
