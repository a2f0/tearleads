/** Request and response body bytes, as the app's request recorder sums them. */
export interface BodyBytes {
  readonly request: number;
  readonly response: number;
}

export interface EndpointMetrics {
  readonly count: number;
  readonly bodyBytes: BodyBytes;
}

/** One `[dual-pane-request-metrics]` line: a measured phase of a canary. */
export interface PhaseMetrics {
  readonly label: string;
  readonly total: number;
  readonly bodyBytes: BodyBytes;
  readonly syncIntents: {
    readonly readOnly: number;
    readonly writeBearing: number;
  };
  /** Keyed by `METHOD /normalized/path`. */
  readonly byRequest: Readonly<Record<string, EndpointMetrics>>;
  /** Exact paths sent more than once in the phase, with short ids. */
  readonly repeatedPaths: readonly {
    readonly count: number;
    readonly request: string;
  }[];
}

export interface TestCounts {
  readonly pass: number;
  readonly fail: number;
}

export interface CanaryOutput {
  readonly phases: readonly PhaseMetrics[];
  /** Bun's closing tally, or null when the run ended before printing one. */
  readonly tests: TestCounts | null;
}

const metricsMarker = "[dual-pane-request-metrics] ";
const detailMarker = "[dual-pane-request-profile-detail] ";
const detailSuffix = " repeated-paths";
const repeatedPathLine = /^\s*(\d+) (\S+ \S+)$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    throw new Error(`Request metrics field ${field} is not a count.`);
  return value;
}

function bodyBytes(value: unknown, field: string): BodyBytes {
  if (!isRecord(value)) throw new Error(`Request metrics lack ${field}.`);
  return {
    request: count(Reflect.get(value, "request"), `${field}.request`),
    response: count(Reflect.get(value, "response"), `${field}.response`),
  };
}

function parseMetrics(json: string): Omit<PhaseMetrics, "repeatedPaths"> {
  const value: unknown = JSON.parse(json);
  const label = isRecord(value) ? Reflect.get(value, "label") : undefined;
  if (!isRecord(value) || typeof label !== "string")
    throw new Error("A request metrics line has no label.");
  const syncIntents = Reflect.get(value, "syncIntents");
  const byRequest = Reflect.get(value, "byRequest");
  if (!isRecord(syncIntents) || !isRecord(byRequest))
    throw new Error(`Request metrics for ${label} are incomplete.`);
  return {
    label,
    total: count(Reflect.get(value, "total"), "total"),
    bodyBytes: bodyBytes(Reflect.get(value, "bodyBytes"), "bodyBytes"),
    syncIntents: {
      readOnly: count(
        Reflect.get(syncIntents, "readOnly"),
        "syncIntents.readOnly",
      ),
      writeBearing: count(
        Reflect.get(syncIntents, "writeBearing"),
        "syncIntents.writeBearing",
      ),
    },
    byRequest: Object.fromEntries(
      Object.entries(byRequest).map(([key, entry]) => {
        if (!isRecord(entry)) throw new Error(`Request metrics for ${key}.`);
        return [
          key,
          {
            count: count(Reflect.get(entry, "count"), `${key}.count`),
            bodyBytes: bodyBytes(
              Reflect.get(entry, "bodyBytes"),
              `${key}.bodyBytes`,
            ),
          },
        ];
      }),
    ),
  };
}

function testCount(text: string, outcome: "pass" | "fail"): number | null {
  const matches = [
    ...text.matchAll(new RegExp(`^ *(\\d+) ${outcome}$`, "gmu")),
  ];
  const last = matches.at(-1)?.[1];
  return last === undefined ? null : Number(last);
}

/** The repeated-path lines that start at `start`, and the index after them. */
function readRepeatedPaths(
  lines: readonly string[],
  start: number,
): { paths: PhaseMetrics["repeatedPaths"]; next: number } {
  const paths: { count: number; request: string }[] = [];
  let next = start;
  for (; next < lines.length; next += 1) {
    const match = repeatedPathLine.exec(lines[next] ?? "");
    if (!match?.[1] || !match[2]) break;
    paths.push({ count: Number(match[1]), request: match[2] });
  }
  return { paths, next };
}

function isDetailHeading(line: string, phase: PhaseMetrics): boolean {
  const at = line.indexOf(detailMarker);
  return (
    at !== -1 &&
    line.slice(at + detailMarker.length) === `${phase.label}${detailSuffix}`
  );
}

/**
 * Reads the profile lines a request-volume canary prints with
 * `DUAL_PANE_REQUEST_PROFILE=1` and `DUAL_PANE_REQUEST_PROFILE_DETAIL=1`.
 * Each metrics line opens a phase; the detail block that follows it with the
 * same label lists that phase's repeated exact paths.
 */
export function parseCanaryOutput(text: string): CanaryOutput {
  const phases: PhaseMetrics[] = [];
  const lines = text.split(/\r?\n/u);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    index += 1;
    const metricsAt = line.indexOf(metricsMarker);
    const phase = phases.at(-1);
    if (metricsAt !== -1) {
      const json = line.slice(metricsAt + metricsMarker.length);
      phases.push({ ...parseMetrics(json), repeatedPaths: [] });
    } else if (phase && isDetailHeading(line, phase)) {
      const { paths, next } = readRepeatedPaths(lines, index);
      phases[phases.length - 1] = { ...phase, repeatedPaths: paths };
      index = next;
    }
  }
  const pass = testCount(text, "pass");
  const fail = testCount(text, "fail");
  return {
    phases,
    tests: pass === null || fail === null ? null : { pass, fail },
  };
}
