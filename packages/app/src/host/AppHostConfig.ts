import type { AppDatabaseWorker } from "../db/sqliteWorker";

export type CreateWorkerFn = () => AppDatabaseWorker;

export class AppHostConfig {
  constructor(
    readonly apiBaseUrl: string,
    readonly wsUrl: string,
    readonly createWorker?: CreateWorkerFn,
    readonly trustedPolicySigners: ReadonlyMap<string, Uint8Array> = new Map(),
  ) {}
}
