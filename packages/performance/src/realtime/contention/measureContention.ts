import type { SeededTree } from "../artifacts";
import {
  type AuthorizationCall,
  createProbeHub,
  type ProbeSocket,
} from "../hubSocket";
import type { InProcessApi } from "../inProcessApi";
import { type PostgresTraffic, trafficSince } from "../postgresWire";
import { type ResourceUse, startResourceSampler } from "../resources";
import { type HintLag, startHintMonitor, systemClock } from "./hintMonitor";
import type { ContentionOptions } from "./options";

/**
 * `unmarked` is a declaration whose manifests carry no verification marker
 * this process accepts, so each is verified in full.
 */
export type ContentionPass =
  | "idle"
  | "unmarked"
  | "declaration"
  | "revalidation";

export interface ContentionMeasurement {
  readonly pass: ContentionPass;
  /** Folders each socket declared; 0 for the idle control. */
  readonly size: number;
  /** Sockets running the pass at once; 0 for the idle control. */
  readonly sockets: number;
  readonly sample: number;
  /** From starting every socket's pass until the last one completed. */
  readonly durationMs: number;
  /** Each socket's authorization call, fastest first. */
  readonly authorizationMs: readonly number[];
  /** Hints for the observing socket published during the pass. */
  readonly hints: HintLag;
  readonly database: PostgresTraffic;
  readonly resources: ResourceUse;
}

type ProbeHub = ReturnType<typeof createProbeHub>;

// Long enough for a few hundred hints at the default interval.
const IDLE_MS = 1_000;

const round = (value: number) => Math.round(value * 10) / 10;

interface Observed {
  readonly durationMs: number;
  readonly hints: HintLag;
  readonly database: PostgresTraffic;
  readonly resources: ResourceUse;
}

/** Runs `work` while hints flow to `observer`, measuring the hub around it. */
async function observeWork(input: {
  readonly hub: ProbeHub;
  readonly observer: ProbeSocket;
  readonly containerId: string;
  readonly intervalMs: number;
  readonly traffic: () => PostgresTraffic;
  readonly work: () => Promise<void>;
}): Promise<Observed> {
  const sampler = startResourceSampler();
  const before = input.traffic();
  const monitor = startHintMonitor(
    {
      intervalMs: input.intervalMs,
      containerId: input.containerId,
      observer: input.observer,
      publish: input.hub.publish,
    },
    systemClock,
  );
  const started = performance.now();
  let failed = false;
  let failure: unknown;
  try {
    await input.work();
  } catch (error) {
    failed = true;
    failure = error;
  }
  const durationMs = round(performance.now() - started);
  // Both timers stop on every path.
  const resources = sampler.stop();
  let hints: HintLag;
  try {
    hints = monitor.stop();
  } catch (error) {
    // The pass's own failure is the one to report.
    throw failed ? failure : error;
  }
  if (failed) throw failure;
  if (hints.delivered !== hints.sent)
    throw new Error(
      `${hints.sent - hints.delivered} of ${hints.sent} hints never reached the observing socket.`,
    );
  const database = trafficSince(input.traffic(), before);
  return { durationMs, hints, database, resources };
}

/** The sockets' own authorization calls, checked complete. */
function socketCalls(
  calls: readonly AuthorizationCall[],
  { size, sockets }: { readonly size: number; readonly sockets: number },
  pass: ContentionPass,
): number[] {
  const own = calls.filter((call) => call.ids === size);
  if (
    own.length !== sockets ||
    calls.some((call) => call.failed) ||
    own.some((call) => call.proofs !== size)
  )
    throw new Error(
      `The ${pass} pass did not authorize ${size} folders on each of ${sockets} sockets.`,
    );
  return own.map((call) => round(call.durationMs)).sort((a, b) => a - b);
}

/** A hub with one observing socket that holds the tree's root. */
async function openObservedHub(api: InProcessApi, seed: SeededTree) {
  const hub = createProbeHub(api);
  const observer = hub.openSocket(seed.userId);
  const containerId = seed.containerIds[0];
  if (!containerId) throw new Error("The seeded tree is empty.");
  if ((await observer.declare([containerId])).authorized !== 1)
    throw new Error("The observing socket's folder was not authorized.");
  return { hub, observer, containerId };
}

async function measureIdle(
  input: MeasureInput,
  sample: number,
): Promise<ContentionMeasurement> {
  const { hub, observer, containerId } = await openObservedHub(
    input.api,
    input.seed,
  );
  try {
    const observed = await observeWork({
      hub,
      observer,
      containerId,
      intervalMs: input.options.hintIntervalMs,
      traffic: input.traffic,
      work: () => Bun.sleep(input.idleMs ?? IDLE_MS),
    });
    return {
      pass: "idle",
      size: 0,
      sockets: 0,
      sample,
      authorizationMs: [],
      ...observed,
    };
  } finally {
    hub.stop();
  }
}

type SocketPass = Exclude<ContentionPass, "idle">;

/**
 * One gateway where `sockets` sockets run `passes` in order, each pass on
 * every socket at once, while hints flow to an observing socket.
 */
async function measureSockets(
  input: MeasureInput,
  shape: { readonly size: number; readonly sockets: number },
  sample: number,
  passes: readonly SocketPass[],
): Promise<ContentionMeasurement[]> {
  const { size, sockets } = shape;
  const ids = input.seed.containerIds.slice(0, size);
  if (ids.length < size)
    throw new Error(`The seeded tree holds only ${ids.length} folders.`);
  const { hub, observer, containerId } = await openObservedHub(
    input.api,
    input.seed,
  );
  try {
    const heavy = Array.from({ length: sockets }, () =>
      hub.openSocket(input.seed.userId),
    );
    const work = (kind: SocketPass) => async () => {
      if (kind === "revalidation") await hub.revalidateAll();
      else await Promise.all(heavy.map((socket) => socket.declare(ids)));
    };
    const measured: ContentionMeasurement[] = [];
    for (const kind of passes) {
      const firstCall = hub.calls.length;
      const observed = await observeWork({
        hub,
        observer,
        containerId,
        intervalMs: input.options.hintIntervalMs,
        traffic: input.traffic,
        work: work(kind),
      });
      measured.push({
        pass: kind,
        size,
        sockets,
        sample,
        authorizationMs: socketCalls(hub.calls.slice(firstCall), shape, kind),
        ...observed,
      });
    }
    return measured;
  } finally {
    hub.stop();
  }
}

interface MeasureInput {
  readonly api: InProcessApi;
  readonly options: ContentionOptions;
  readonly seed: SeededTree;
  readonly traffic: () => PostgresTraffic;
  /** How long the idle control runs; one second by default. */
  readonly idleMs?: number;
}

/**
 * First, for a reused tree, one socket declares the largest size while no
 * manifest carries a marker this process accepts, so every one is verified
 * in full (`unmarked`). That pass also loads and compiles the hub's code; a
 * tree seeded in this process warmed it already. Then an idle control per
 * sample, and for each size, socket count and sample, one gateway where that
 * many sockets declare the size at once and then revalidate at once, against
 * the markers the first pass recorded.
 */
export async function measureContention(
  input: MeasureInput & {
    readonly measured: (measurement: ContentionMeasurement) => Promise<void>;
  },
): Promise<void> {
  // A tree seeded by this process was marked under this process's key as
  // each folder was written, so only a reused tree can be measured unmarked.
  if (input.options.reuse)
    for (const measurement of await measureSockets(
      input,
      { size: input.options.sizes.at(-1) ?? 0, sockets: 1 },
      1,
      ["unmarked"],
    ))
      await input.measured(measurement);
  for (let sample = 1; sample <= input.options.samples; sample++)
    await input.measured(await measureIdle(input, sample));
  for (const size of input.options.sizes)
    for (const sockets of input.options.sockets)
      for (let sample = 1; sample <= input.options.samples; sample++)
        for (const measurement of await measureSockets(
          input,
          { size, sockets },
          sample,
          ["declaration", "revalidation"],
        ))
          await input.measured(measurement);
}
