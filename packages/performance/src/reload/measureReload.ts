import { type PostgresTraffic, trafficSince } from "../realtime/postgresWire";
import type { ReloadAccount, ReloadOutcome } from "./reloadAccount";

export interface ReloadMeasurement extends ReloadOutcome {
  readonly documents: number;
  readonly folders: number;
  /** The first reload after this size's notes were created, or a later one. */
  readonly reload: "first" | "settled";
  readonly sample: number;
  readonly database: PostgresTraffic;
  /** Statements the client ran against its local SQLite database. */
  readonly localSql: { readonly calls: number; readonly durationMs: number };
}

/**
 * Grows the account to each size, then reloads it once after the notes were
 * created and `samples` more times with nothing changed.
 */
export async function measureReloads(input: {
  readonly account: Pick<
    ReloadAccount,
    "grow" | "reload" | "folders" | "localSql"
  >;
  readonly options: {
    readonly documents: readonly number[];
    readonly perFolder: number;
    readonly samples: number;
  };
  readonly traffic: () => PostgresTraffic;
  readonly grown?:
    | ((documents: number, durationMs: number) => void)
    | undefined;
  readonly measured: (measurement: ReloadMeasurement) => Promise<void>;
}): Promise<void> {
  const { account, options } = input;
  for (const documents of options.documents) {
    const started = performance.now();
    await account.grow(documents, options.perFolder);
    input.grown?.(documents, Math.round(performance.now() - started));
    const reloads = [
      { reload: "first" as const, sample: 1 },
      ...Array.from({ length: options.samples }, (_, index) => ({
        reload: "settled" as const,
        sample: index + 1,
      })),
    ];
    for (const { reload, sample } of reloads) {
      const traffic = input.traffic();
      const localSql = account.localSql();
      const outcome = await account.reload();
      const localAfter = account.localSql();
      await input.measured({
        documents,
        folders: account.folders(),
        reload,
        sample,
        ...outcome,
        database: trafficSince(input.traffic(), traffic),
        localSql: {
          calls: localAfter.calls - localSql.calls,
          durationMs: Math.round(localAfter.durationMs - localSql.durationMs),
        },
      });
    }
  }
}
