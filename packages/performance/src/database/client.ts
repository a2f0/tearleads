import { setTimeout as delay } from "node:timers/promises";
import { jsonRecord } from "../jsonRecord";
import { requestHeader } from "../transport";
import { type DatabaseSample, mean, parseMeasurement } from "./sample";

export async function ready(
  origin: string,
  headers: HeadersInit,
  runId: string,
  signal: AbortSignal,
) {
  for (let attempt = 0; attempt < 15; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetch(`${origin}/health`, {
        headers,
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      });
      if (
        response.ok &&
        Reflect.get(jsonRecord(await response.json()), "runId") === runId
      )
        return;
    } catch {
      signal.throwIfAborted();
    }
    await delay(2_000, undefined, { signal });
  }
  throw new Error("Probe Worker did not become ready.");
}

export async function collectSamples(input: {
  origin: string;
  headers: Record<string, string>;
  runId: string;
  count: number;
  signal: AbortSignal;
  onSample: (sample: DatabaseSample) => Promise<void>;
}) {
  for (let index = 1; index <= input.count; index++) {
    input.signal.throwIfAborted();
    const start = performance.now();
    const response = await fetch(`${input.origin}/probe`, {
      method: "POST",
      headers: {
        ...input.headers,
        [requestHeader]: `${input.runId}-${index}-1`,
      },
      redirect: "error",
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(45_000)]),
    });
    if (!response.ok)
      throw new Error(
        `Probe failed (HTTP ${response.status}); no sample retry.`,
      );
    const sample = {
      index,
      ...parseMeasurement(await response.json(), input.runId),
      httpMs: performance.now() - start,
      cfRay: response.headers.get("cf-ray"),
      receivedAt: new Date().toISOString(),
    };
    await input.onSample(sample);
    const m = sample.measurements;
    console.info(
      JSON.stringify({
        sample: index,
        placement: sample.placement,
        connectMs: m.connectMs,
        simpleMeanMs: mean(m.simpleMs),
        parameterizedMeanMs: mean(m.parameterizedMs),
        batchMs: m.batchMs,
        planningMs: m.planningMs,
        executionMs: m.executionMs,
      }),
    );
    if (index < input.count)
      await delay(1_000, undefined, { signal: input.signal });
  }
}
