import { createPayloadAuditor } from "../canaries/payloadAudit";
import type { ScenarioHttpRecord } from "./httpCapture";
import { normalizeScenarioRoute } from "./routeNormalize";

export interface ScenarioHttpObservation {
  readonly authorization: string | null;
  readonly durationMs: number;
  readonly knownManifestsCount: number;
  readonly method: string;
  readonly requestBody: string | null;
  readonly requestBodyBytes: number;
  readonly responseBody: string;
  readonly responseBodyBytes: number;
  readonly status: number;
  readonly url: string;
}

interface PendingStackEntry {
  readonly stack: string;
  consumed: boolean;
}

const worldOperationPattern = /^[a-z][A-Za-z]+$/u;

function parseErrorCode(status: number, body: string): string | undefined {
  if (status < 400 || !body) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const code: unknown = Reflect.get(parsed, "code");
    return typeof code === "string" && code.length > 0 ? code : undefined;
  } catch {
    return undefined;
  }
}

function scenarioPathKey(method: string, url: string): string {
  try {
    const parsed = new URL(url);
    return `${method.toUpperCase()} ${parsed.pathname}${parsed.search}`;
  } catch {
    return `${method.toUpperCase()} ${url}`;
  }
}

/**
 * Pure observer core shared by `scenarioHttpPreload.ts` and unit tests:
 * records sanitized HTTP/operation JSONL lines, feeds optional payload audit,
 * and cleans up unconsumed client fetch stacks (such as requests dropped by a
 * `DeviceTransport` before-request gate).
 */
export function createScenarioHttpObserver(options: {
  readonly writeHttp: (line: string) => void;
  readonly limit: number;
  readonly writePayload?: (line: string) => void;
  readonly captureStacks?: boolean;
}) {
  const auditor = options.writePayload
    ? createPayloadAuditor({ write: options.writePayload })
    : null;
  const stackQueues = new Map<string, PendingStackEntry[]>();
  let written = 0;
  let testNumber = 0;
  let payloadRequestIndex = 0;

  const record = (entry: ScenarioHttpRecord): void => {
    if (written > options.limit) return;
    written += 1;
    options.writeHttp(
      `${JSON.stringify(written > options.limit ? { truncated: options.limit } : entry)}\n`,
    );
  };

  const enqueueStack = (method: string, url: string, stack: string) => {
    const key = scenarioPathKey(method, url);
    const entry: PendingStackEntry = { stack, consumed: false };
    const queue = stackQueues.get(key) ?? [];
    queue.push(entry);
    stackQueues.set(key, queue);
    return () => {
      if (entry.consumed) return;
      const list = stackQueues.get(key);
      if (!list) return;
      const idx = list.indexOf(entry);
      if (idx !== -1) list.splice(idx, 1);
      if (list.length === 0) stackQueues.delete(key);
    };
  };

  const takeStack = (method: string, url: string): string | undefined => {
    if (!options.captureStacks) return undefined;
    const key = scenarioPathKey(method, url);
    const list = stackQueues.get(key);
    const next = list?.shift();
    if (list && list.length === 0) stackQueues.delete(key);
    if (!next) return undefined;
    next.consumed = true;
    return next.stack;
  };

  return {
    startTest(): void {
      testNumber += 1;
      payloadRequestIndex = 0;
      auditor?.resetTest();
      stackQueues.clear();
    },
    enqueueStack,
    observeHttp(obs: ScenarioHttpObservation): void {
      const route = normalizeScenarioRoute(obs.method, obs.url);
      const errorCode = parseErrorCode(obs.status, obs.responseBody);
      record({
        kind: "http",
        route,
        method: obs.method.toUpperCase(),
        status: obs.status,
        ...(errorCode !== undefined ? { errorCode } : {}),
        requestBytes: obs.requestBodyBytes,
        responseBytes: obs.responseBodyBytes,
        durationMs: Math.round(obs.durationMs * 10) / 10,
        knownManifestsCount: obs.knownManifestsCount,
      });
      if (auditor) {
        const index = payloadRequestIndex;
        payloadRequestIndex += 1;
        auditor.recordPhase({
          label: `test-${testNumber}`,
          startIndex: index,
          requests: [{ ...obs, routeKey: route }],
          takeStack,
        });
      }
    },
    observeTrace(message: string): void {
      if (worldOperationPattern.test(message)) {
        record({ kind: "op", name: message });
      }
    },
  };
}
