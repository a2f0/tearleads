import { jsonRecord } from "../jsonRecord";
import type { DatabaseMeasurement } from "./probe";
import { repetitions } from "./probe";

export function parseMeasurement(value: unknown, runId: string) {
  const record = jsonRecord(value);
  if (
    Reflect.get(record, "runId") !== runId ||
    Reflect.get(record, "repetitions") !== repetitions
  )
    throw new Error("Probe response does not match this experiment.");
  function finite(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      throw new Error("Invalid probe measurement.");
    return value;
  }
  function number(key: string) {
    return finite(Reflect.get(record, key));
  }
  function list(key: string) {
    const values: unknown = Reflect.get(record, key);
    if (!Array.isArray(values) || values.length !== repetitions)
      throw new Error("Incomplete probe measurement.");
    return values.map(finite);
  }
  const measurements: DatabaseMeasurement = {
    connectMs: number("connectMs"),
    beginMs: number("beginMs"),
    firstQueryMs: number("firstQueryMs"),
    simpleMs: list("simpleMs"),
    parameterizedMs: list("parameterizedMs"),
    batchMs: number("batchMs"),
    explainRoundTripMs: number("explainRoundTripMs"),
    planningMs: number("planningMs"),
    executionMs: number("executionMs"),
    commitMs: number("commitMs"),
    elapsedMs: number("elapsedMs"),
    repetitions,
  };
  const placement: unknown = Reflect.get(record, "placement");
  return {
    measurements,
    placement:
      typeof placement === "string" &&
      /^(local|remote)-[A-Z0-9]{3,6}$/.test(placement)
        ? placement
        : null,
  };
}

export interface DatabaseSample extends ReturnType<typeof parseMeasurement> {
  index: number;
  receivedAt: string;
  httpMs: number;
  cfRay: string | null;
}

export function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
