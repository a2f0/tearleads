import { type PostgresTraffic, trafficSince } from "../inProcess/postgresWire";
import type { LocalSqlAttribution } from "../localDatabase";
import type { ReloadAccount, ReloadOutcome } from "./reloadAccount";

export interface ReloadMeasurement extends ReloadOutcome {
  readonly documents: number;
  readonly folders: number;
  /** The first reload after creates, a settled reload, or after peer edits. */
  readonly reload: "first" | "settled" | "peer-edited";
  readonly sample: number;
  readonly database: PostgresTraffic;
  /** Statements the client ran against its local SQLite database. */
  readonly localSql: {
    readonly calls: number;
    readonly durationMs: number;
    readonly attribution?: LocalSqlAttribution;
  };
}

/**
 * Grows the account to each size, then reloads it once after the notes were
 * created and `samples` more times with nothing changed. When `peerEdits` is
 * positive, an independent peer adds notes and one `peer-edited` reload runs.
 */
export async function measureReloads(input: {
  readonly account: Pick<
    ReloadAccount,
    "grow" | "reload" | "folders" | "localSql"
  > &
    Partial<Pick<ReloadAccount, "captureSqlWindow" | "peerEdit">>;
  readonly options: {
    readonly documents: readonly number[];
    readonly perFolder: number;
    readonly samples: number;
    readonly ackDelayMs?: number;
    readonly peerEdits?: number;
  };
  readonly traffic: () => PostgresTraffic;
  readonly grown?:
    | ((documents: number, durationMs: number) => void)
    | undefined;
  readonly measured: (measurement: ReloadMeasurement) => Promise<void>;
}): Promise<void> {
  const { account, options } = input;
  const ackDelayMs = options.ackDelayMs ?? 0;
  const peerEdits = options.peerEdits ?? 0;
  const runOne = async (
    documents: number,
    reload: ReloadMeasurement["reload"],
    sample: number,
  ) => {
    const traffic = input.traffic();
    const localSql = account.localSql();
    const sqlWindow = account.captureSqlWindow?.();
    let outcome: ReloadOutcome;
    let attribution: LocalSqlAttribution | undefined;
    try {
      outcome = await account.reload(
        ackDelayMs > 0 ? { ackDelayMs } : undefined,
      );
    } finally {
      attribution = sqlWindow?.finish();
    }
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
        ...(attribution ? { attribution } : {}),
      },
    });
  };
  for (const documents of options.documents) {
    const started = performance.now();
    await account.grow(documents, options.perFolder);
    input.grown?.(documents, Math.round(performance.now() - started));
    await runOne(documents, "first", 1);
    for (let sample = 1; sample <= options.samples; sample += 1) {
      await runOne(documents, "settled", sample);
    }
    if (peerEdits > 0 && account.peerEdit) {
      await account.peerEdit(peerEdits);
      await runOne(documents + peerEdits, "peer-edited", 1);
    }
  }
}
