import { createHmac, randomBytes } from "node:crypto";

/** One line of a capture file. */
export type CaptureRecord =
  | {
      /** `globalThis.sqlCaptureLabel` when a probe set it, else `test-<n>`. */
      readonly label: string;
      readonly sql: string;
      /** How many bind values the statement carried; values are never kept. */
      readonly params: number;
      /** A short hash of the bind values, keyed per capture, when asked for. */
      readonly paramHash?: string;
      /**
       * The HTTP request the statement ran in, numbered from 1 in the order
       * requests first send a statement: the scope the API's request-cost
       * middleware marks, inside any counter a test opens around it. Outside
       * every request, the outermost counter; absent outside every counter.
       */
      readonly request?: number;
      /**
       * Managed database transaction number within this capture, numbered
       * from 1 in order of first statement. Omitted outside transactions.
       */
      readonly tx?: number;
    }
  | {
      /** A canary phase started: statements from here to `phaseEnd` belong to it. */
      readonly phaseStart: string;
    }
  | {
      /** A canary phase ended: its `[dual-pane-request-metrics]` label. */
      readonly phaseEnd: string;
      readonly requests: number;
    }
  | {
      /** Route template for one HTTP request scope, emitted when it completes. */
      readonly requestScope: number;
      readonly method: string;
      readonly route: string;
      readonly status: number;
    }
  | { readonly truncated: number };

export interface RecorderOptions {
  readonly paramHash: boolean;
  /** Records to write before stopping with one `truncated` record. */
  readonly limit: number;
  readonly write: (line: string) => void;
  /** The label a probe set for the work it measures, if any. */
  readonly label: () => string | undefined;
}

export interface StatementRecorder {
  /** Called before each test, so unlabelled statements name their test. */
  startTest(): void;
  statement(
    sql: string,
    parameters: readonly unknown[],
    scope: object | undefined,
    transaction?: object | undefined,
  ): void;
  requestScope(
    scope: object,
    meta: {
      readonly method: string;
      readonly route: string;
      readonly status: number;
    },
  ): void;
  phaseStart(label: string): void;
  phaseEnd(label: string, requests: number): void;
}

/**
 * Hashes are keyed with a random key per recorder, so they match only within
 * one capture and cannot confirm a guessed value such as an email.
 */
function hashParameters(key: Buffer, parameters: readonly unknown[]): string {
  const json = JSON.stringify(parameters, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  return createHmac("sha256", key).update(json).digest("hex").slice(0, 12);
}

export function createStatementRecorder(
  options: RecorderOptions,
): StatementRecorder {
  const hashKey = randomBytes(32);
  let testNumber = 0;
  let written = 0;
  const requests = new WeakMap<object, number>();
  let requestCount = 0;
  const requestNumber = (scope: object): number => {
    const known = requests.get(scope);
    if (known !== undefined) return known;
    requestCount += 1;
    requests.set(scope, requestCount);
    return requestCount;
  };
  const transactions = new WeakMap<object, number>();
  let transactionCount = 0;
  const transactionNumber = (transaction: object): number => {
    const known = transactions.get(transaction);
    if (known !== undefined) return known;
    transactionCount += 1;
    transactions.set(transaction, transactionCount);
    return transactionCount;
  };
  const record = (entry: CaptureRecord) => {
    if (written > options.limit) return;
    written += 1;
    options.write(
      `${JSON.stringify(written > options.limit ? { truncated: options.limit } : entry)}\n`,
    );
  };
  return {
    startTest() {
      testNumber += 1;
    },
    statement(sql, parameters, scope, transaction) {
      record({
        label: options.label() ?? `test-${testNumber}`,
        sql,
        params: parameters.length,
        ...(options.paramHash
          ? { paramHash: hashParameters(hashKey, parameters) }
          : {}),
        ...(scope === undefined ? {} : { request: requestNumber(scope) }),
        ...(transaction === undefined
          ? {}
          : { tx: transactionNumber(transaction) }),
      });
    },
    requestScope(scope, meta) {
      record({
        requestScope: requestNumber(scope),
        method: meta.method,
        route: meta.route,
        status: meta.status,
      });
    },
    phaseStart(label) {
      record({ phaseStart: label });
    },
    phaseEnd(label, requests) {
      record({ phaseEnd: label, requests });
    },
  };
}

const metricsMarker = "[dual-pane-request-metrics] ";
const phaseStartMarker = "[dual-pane-request-phase-start] ";

/** The phase label a `[dual-pane-request-phase-start]` line opens, or null. */
export function phaseStartFromConsole(args: readonly unknown[]): string | null {
  const [first] = args;
  if (typeof first !== "string" || !first.startsWith(phaseStartMarker))
    return null;
  let payload: unknown;
  try {
    payload = JSON.parse(first.slice(phaseStartMarker.length));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const label: unknown = Reflect.get(payload, "label");
  return typeof label === "string" ? label : null;
}

/**
 * The phase a canary's metrics line closes, or null for any other line. A
 * malformed metrics line is null too: the preload must still log it, so the
 * profile parser fails that run, rather than throw inside the canary.
 */
export function phaseFromConsole(
  args: readonly unknown[],
): { label: string; requests: number } | null {
  const [first] = args;
  if (typeof first !== "string" || !first.startsWith(metricsMarker))
    return null;
  let metrics: unknown;
  try {
    metrics = JSON.parse(first.slice(metricsMarker.length));
  } catch {
    return null;
  }
  if (typeof metrics !== "object" || metrics === null) return null;
  const label: unknown = Reflect.get(metrics, "label");
  const requests: unknown = Reflect.get(metrics, "total");
  return typeof label === "string" && typeof requests === "number"
    ? { label, requests }
    : null;
}

export interface CaptureEnvironment {
  readonly out: string;
  readonly paramHash: boolean;
  readonly limit: number;
}

/** Records kept by default: under 1 GB of typical API statements. */
export const defaultCaptureLimit = 1_000_000;

/** The variables the preload reads; `process.env` satisfies it. */
export interface CaptureVariables {
  readonly [name: string]: string | undefined;
  readonly PERF_STATEMENTS_OUT?: string;
  readonly PERF_STATEMENTS_PARAM_HASH?: string;
  readonly PERF_STATEMENTS_LIMIT?: string;
}

export function readCaptureEnvironment(
  env: CaptureVariables,
): CaptureEnvironment {
  const out = env.PERF_STATEMENTS_OUT;
  if (!out) throw new Error("PERF_STATEMENTS_OUT must name the capture file.");
  const limit = env.PERF_STATEMENTS_LIMIT;
  if (limit !== undefined && !/^[1-9]\d*$/u.test(limit))
    throw new Error("PERF_STATEMENTS_LIMIT must be a positive integer.");
  return {
    out,
    paramHash: env.PERF_STATEMENTS_PARAM_HASH === "1",
    limit: limit === undefined ? defaultCaptureLimit : Number(limit),
  };
}
