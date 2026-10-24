import { openCloudflareTail } from "./cloudflare";
import { type Options, targets } from "./options";
import { provision, type Sample } from "./provision";

type Tail = Awaited<ReturnType<typeof openCloudflareTail>>;

interface RunInput {
  options: Options;
  runId: string;
  samples: Sample[];
  signal: AbortSignal;
  save: (
    status: "running" | "complete" | "failed",
    tail?: Tail,
  ) => Promise<void>;
  onSample: (sample: Sample, tail?: Tail) => void;
}

interface RunDependencies {
  provision: typeof provision;
  openTail: typeof openCloudflareTail;
  pause: (milliseconds: number) => Promise<void>;
}

const defaultDependencies: RunDependencies = {
  provision,
  openTail: openCloudflareTail,
  pause: async (milliseconds) => {
    await Bun.sleep(milliseconds);
  },
};

async function drainTail(
  input: RunInput,
  tail: Tail,
  pause: RunDependencies["pause"],
) {
  const deadline = performance.now() + 10_000;
  while (
    performance.now() < deadline &&
    !input.signal.aborted &&
    input.samples.some((sample) =>
      sample.requests.some(
        (request) =>
          !tail.events.some((event) => event.requestId === request.id),
      ),
    )
  )
    await pause(100);
}

export async function runExperiment(
  input: RunInput,
  dependencies = defaultDependencies,
): Promise<boolean> {
  const target = targets[input.options.environment];
  let tail: Tail | undefined;
  let completed = false;
  try {
    await input.save("running");
    if (input.options.cloudflare)
      tail = await dependencies.openTail(target.worker, input.runId);
    for (let index = 1; index <= input.options.samples; index += 1) {
      if (input.signal.aborted) break;
      const sample = await dependencies.provision({
        origin: target.origin,
        runId: input.runId,
        index,
        signal: AbortSignal.any([input.signal, AbortSignal.timeout(60_000)]),
      });
      input.samples.push(sample);
      await input.save("running", tail);
      input.onSample(sample, tail);
      if (sample.status === "failed") break;
      if (index < input.options.samples && !input.signal.aborted)
        await dependencies.pause(1_000);
    }
    if (tail) await drainTail(input, tail, dependencies.pause);
    completed =
      !input.signal.aborted &&
      input.samples.length === input.options.samples &&
      input.samples.every((sample) => sample.status === "passed");
  } finally {
    try {
      await tail?.close();
    } finally {
      await input.save(completed ? "complete" : "failed", tail);
    }
  }
  return completed;
}

export async function withInterruptionSignal(
  run: (signal: AbortSignal) => Promise<boolean>,
): Promise<boolean> {
  const interrupted = new AbortController();
  const stop = () => interrupted.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    return await run(interrupted.signal);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
