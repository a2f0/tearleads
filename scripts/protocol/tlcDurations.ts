/**
 * Recorded TLC run durations, which the protocol checks use to start their
 * longest runs first: once runs overlap, a long run that starts late stretches
 * a check past every other run. Durations steer only the order runs start in,
 * never what a check runs, so an entry for a run nothing registers is ignored.
 *
 * Each file holds `<seconds> <key>` lines, longest first. A model run is keyed
 * by its `model|config` registry pair, a negative control by its id.
 * `bun run generate:protocol-durations <log>...` rewrites both files from the
 * output of the checks, such as a CI job log.
 */

export const MODEL_DURATIONS_PATH = "formal/protocol-model-durations.txt";
export const CONTROL_DURATIONS_PATH =
  "formal/protocol-negative-control-durations.txt";

/** Seconds by key; throws on a malformed line or a repeated key. */
export function parseTlcDurations(
  text: string,
  path: string,
): Map<string, number> {
  const durations = new Map<string, number>();
  for (const [index, line] of text.split("\n").entries()) {
    if (line === "" || line.startsWith("#")) continue;
    const [, seconds, key] = /^([0-9]+) (\S+)$/.exec(line) ?? [];
    if (seconds === undefined || key === undefined) {
      throw new Error(`${path}:${index + 1} must read '<seconds> <key>'.`);
    }
    if (durations.has(key)) {
      throw new Error(`${path}:${index + 1} repeats ${key}.`);
    }
    durations.set(key, Number(seconds));
  }
  return durations;
}

/** The file text for `durations`, longest first, ties in key order. */
export function formatTlcDurations(
  header: readonly string[],
  durations: ReadonlyMap<string, number>,
): string {
  const lines = [...durations]
    .sort(
      ([leftKey, left], [rightKey, right]) =>
        right - left || (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0),
    )
    .map(([key, seconds]) => `${seconds} ${key}`);
  return `${[...header.map((line) => `# ${line}`), ...lines].join("\n")}\n`;
}

/**
 * Orders items longest recorded duration first. An item with no recorded
 * duration goes first, since it may be long; ties keep their input order.
 */
export function longestFirst<T>(
  items: readonly T[],
  durations: ReadonlyMap<string, number>,
  key: (item: T) => string,
): T[] {
  const seconds = (item: T) =>
    durations.get(key(item)) ?? Number.POSITIVE_INFINITY;
  return items
    .map((item, index) => ({ item, index, seconds: seconds(item) }))
    .sort(
      (left, right) =>
        (left.seconds === right.seconds ? 0 : right.seconds - left.seconds) ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}

/**
 * The recorded durations for registered keys, and the keys nothing registers
 * any more. Durations only order runs, so an entry a renamed or removed run
 * left behind is ignored rather than failing the check; `staleDurationsNote`
 * names it so a refresh is obvious.
 */
export function registeredDurations(
  durations: ReadonlyMap<string, number>,
  registered: ReadonlySet<string>,
): { durations: Map<string, number>; stale: string[] } {
  const kept = new Map<string, number>();
  const stale: string[] = [];
  for (const [key, seconds] of durations) {
    if (registered.has(key)) kept.set(key, seconds);
    else stale.push(key);
  }
  return { durations: kept, stale };
}

/** The one line a check prints for ignored entries, as the model check does. */
export function staleDurationsNote(
  path: string,
  registry: string,
  stale: readonly string[],
): string {
  return `Note: ${path} lists runs ${registry} does not register, ignored: ${stale.join(" ")}. Regenerate it with bun run generate:protocol-durations <log>...`;
}

function finishedSeconds(text: string): number | undefined {
  const [, hours = "0", minutes = "0", seconds] =
    /^(?:(\d+)h )?(?:(\d+)min )?(\d+)s$/.exec(text) ?? [];
  return seconds === undefined
    ? undefined
    : Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/**
 * The durations a check's output reports: each model's TLC `Finished in` line
 * after its `Checking` line, and each negative control's success line. A
 * leading CI log timestamp is ignored.
 */
export function durationsFromCheckOutput(text: string): {
  models: Map<string, number>;
  controls: Map<string, number>;
} {
  const models = new Map<string, number>();
  const controls = new Map<string, number>();
  let model: string | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, "").trimEnd();
    const checking = /^Checking (\S+) with (\S+)\.\.\.$/.exec(line);
    if (checking) {
      model = `${checking[1]}|${checking[2]}`;
      continue;
    }
    const finished = /^Finished in (.+) at \(/.exec(line)?.[1];
    if (model !== undefined && finished !== undefined) {
      const seconds = finishedSeconds(finished);
      if (seconds !== undefined) models.set(model, seconds);
      model = undefined;
      continue;
    }
    const [, id, elapsed] =
      /^(\S+): TLC reported .+ violated, as expected \((\d+(?:\.\d+)?)s\)\.$/.exec(
        line,
      ) ?? [];
    if (id !== undefined && elapsed !== undefined) {
      controls.set(id, Math.round(Number(elapsed)));
    }
  }
  return { models, controls };
}
