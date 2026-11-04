import type { RecoveryKeyStore } from "./recoveryKeyStore";
import type { TargetName } from "./targets";
import type { Tracer } from "./trace";

/** Everything a command touches outside the SDK, so tests can supply it. */
export interface CliContext {
  apiBaseUrl(target: TargetName): string;
  readonly keyStore: RecoveryKeyStore;
  readRecoveryKey(prompt: string): Promise<string>;
  stderr(line: string): void;
  stdout(line: string): void;
  /** Turns on `--trace` without the flag (TEARLEADS_TRACE=1). */
  readonly traceByDefault?: boolean;
}

export interface CommandInput {
  readonly context: CliContext;
  readonly organizationId: string | undefined;
  readonly target: TargetName;
  readonly tracer: Tracer;
}
