import type { DatabaseRuntime } from "@tearleads/sqlite-worker/runtime";

export type CreateDatabaseRuntimeFn = () => DatabaseRuntime;

export class AppHostConfig {
  constructor(
    readonly apiBaseUrl: string,
    readonly wsUrl: string,
    readonly createDatabaseRuntime?: CreateDatabaseRuntimeFn,
    readonly trustedPolicySigners: ReadonlyMap<string, Uint8Array> = new Map(),
  ) {}
}
