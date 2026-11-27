/**
 * Bun test preload that attaches a payload-audit sink for `perf:canaries
 * --payload-audit`, writing sanitized per-request field-byte, echo,
 * redelivery, and optional issuer-stack records to `PERF_PAYLOAD_AUDIT_OUT`.
 */
import { beforeEach } from "bun:test";
import { createCaptureWriter } from "../statements/captureFile";
import { createPayloadAuditor, type RawPayloadRequest } from "./payloadAudit";

interface PayloadAuditEnv {
  readonly [name: string]: string | undefined;
  readonly PERF_PAYLOAD_AUDIT_OUT?: string;
  readonly PERF_PAYLOAD_AUDIT_STACKS?: string;
}

function readEnv(env: PayloadAuditEnv) {
  const out = env.PERF_PAYLOAD_AUDIT_OUT;
  if (!out) {
    throw new Error("PERF_PAYLOAD_AUDIT_OUT must name the payload audit file.");
  }
  return { out, captureStacks: env.PERF_PAYLOAD_AUDIT_STACKS === "1" };
}

const sinkKey = "__tearleadsPerfPayloadSink";
const { out, captureStacks } = readEnv(process.env);

const auditor = createPayloadAuditor({
  write: createCaptureWriter(out),
});

const stackQueues = new Map<string, string[]>();

function filteredStack(): string {
  const raw = new Error().stack ?? "";
  return raw
    .split("\n")
    .slice(2)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.includes("/packages/") &&
        !line.includes("payloadAuditPreload") &&
        !line.includes("node_modules"),
    )
    .slice(0, 4)
    .join(" <- ");
}

function installFetchStackWrapper(): void {
  if (!captureStacks) return;
  Error.stackTraceLimit = Math.max(Error.stackTraceLimit, 25);
  const original = globalThis.fetch;
  if (Reflect.get(original, "__tearleadsPerfWrapped") === true) return;
  const wrapped = Object.assign(
    function wrappedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = (
        init?.method ??
        (typeof input === "object" && "method" in input ? input.method : "GET")
      ).toUpperCase();
      const key = `${method} ${url}`;
      const queue = stackQueues.get(key) ?? [];
      queue.push(filteredStack());
      stackQueues.set(key, queue);
      return original(input, init);
    },
    original,
    { __tearleadsPerfWrapped: true },
  );
  globalThis.fetch = wrapped;
}

function takeStack(method: string, url: string): string | undefined {
  if (!captureStacks) return undefined;
  const queue = stackQueues.get(`${method.toUpperCase()} ${url}`);
  return queue?.shift();
}

beforeEach(() => {
  auditor.resetTest();
  stackQueues.clear();
  installFetchStackWrapper();
});

installFetchStackWrapper();

Reflect.set(
  globalThis,
  sinkKey,
  (payload: {
    readonly label: string;
    readonly startIndex: number;
    readonly requests: readonly RawPayloadRequest[];
  }) => {
    auditor.recordPhase({
      label: payload.label,
      startIndex: payload.startIndex,
      requests: payload.requests,
      takeStack,
    });
  },
);
