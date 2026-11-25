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
  /** Reads a password, such as a KeePass master password, without echo. */
  readPassword(prompt: string): Promise<string>;
  /**
   * Asks a question on the terminal and reads one visible answer line; null
   * when there is no terminal to ask. Absent where nothing can be asked.
   */
  readLine?(prompt: string): Promise<string | null>;
  stderr(line: string): void;
  stdout(line: string): void;
  /** Turns on `--trace` without the flag (TEARLEADS_TRACE=1). */
  readonly traceByDefault?: boolean;
}

/** `restore-keepass <file>` and its options. */
export interface KeepassRestoreOptions {
  /** The `.kdbx` file to restore. */
  readonly file: string;
  /** `--name`: the restore folder's name. */
  readonly folderName?: string | undefined;
  /** `--key-file`: the database's key file, if it has one. */
  readonly keyFile?: string | undefined;
}

export interface CommandInput {
  /** `--accept-terms`: agree to the legal terms for accounts it creates. */
  readonly acceptTerms?: boolean;
  /** `--api-url`: an API to use in place of the target's. */
  readonly apiUrl?: string | undefined;
  readonly context: CliContext;
  readonly keyFromStdin?: boolean;
  readonly keepass?: KeepassRestoreOptions | undefined;
  readonly organizationId: string | undefined;
  /** `seed --roster`: also seed the dataset's groups and their members. */
  readonly roster?: boolean;
  readonly target: TargetName;
  readonly tracer: Tracer;
}
