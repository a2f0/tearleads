/**
 * On-device timing marks for the DevTools Performance panel. Nothing here
 * leaves the device: entries reach only a locally recorded trace.
 */

export interface UserTimingEntry {
  readonly name: string;
  /** The DevTools track the entry is drawn on, under the Tearleads group. */
  readonly track: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly failed?: boolean | undefined;
  readonly properties?: ReadonlyArray<readonly [string, string]> | undefined;
}

const USER_TIMING_TRACK_GROUP = "Tearleads";

/** Monotonic milliseconds on the same clock as recorded entries. */
export function readUserTimingClock(): number {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}

/**
 * Records one measure for a running trace, then clears it from the timeline
 * buffer at once: DevTools captures the measure when it is created, while an
 * uncleared buffer would grow for the whole session.
 */
export function recordUserTimingEntry(entry: UserTimingEntry): void {
  try {
    const performance = globalThis.performance;
    if (typeof performance?.measure !== "function") {
      return;
    }
    performance.measure(entry.name, {
      detail: {
        devtools: {
          color: entry.failed ? "error" : "primary",
          dataType: "track-entry",
          properties: entry.properties ?? [],
          track: entry.track,
          trackGroup: USER_TIMING_TRACK_GROUP,
        },
      },
      end: entry.endMs,
      start: entry.startMs,
    });
    performance.clearMeasures(entry.name);
  } catch {
    // Diagnostics must never change a sync or SQL outcome.
  }
}
