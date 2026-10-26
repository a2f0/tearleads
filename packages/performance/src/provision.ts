import type { Tearleads } from "@tearleads/client-sdk";
import { openLocalDatabase } from "./localDatabase";
import { createSdkHost } from "./sdkHost";
import { createMeasuredFetch, type RequestMeasurement } from "./transport";

interface Phase {
  name: string;
  startMs: number;
  durationMs: number;
}

export interface Sample {
  id: string;
  status: "running" | "passed" | "failed";
  failurePhase: string | null;
  startedAt: string;
  phases: Phase[];
  requests: RequestMeasurement[];
  localSql: { calls: number; durationMs: number };
  userId: string | null;
  organizationId: string | null;
  sessionRevoked: boolean;
}

export async function provision(input: {
  origin: string;
  runId: string;
  index: number;
  signal: AbortSignal;
}): Promise<Sample> {
  const start = performance.now();
  const sample: Sample = {
    id: `${input.runId}-${input.index}`,
    status: "running",
    failurePhase: null,
    startedAt: new Date().toISOString(),
    phases: [],
    requests: [],
    localSql: { calls: 0, durationMs: 0 },
    userId: null,
    organizationId: null,
    sessionRevoked: false,
  };
  let phase = "setup";
  async function measure<T>(
    name: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    phase = name;
    input.signal.throwIfAborted();
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      sample.phases.push({
        name,
        startMs: startedAt - start,
        durationMs: performance.now() - startedAt,
      });
    }
  }
  const originalFetch = globalThis.fetch;
  let database: Awaited<ReturnType<typeof openLocalDatabase>> | undefined;
  let client: Tearleads | undefined;
  try {
    // SQLite's Bun bootstrap temporarily adapts fetch while loading WASM.
    // Finish it before installing our process-local HTTP instrumentation.
    database = await measure("setup", openLocalDatabase);
    sample.localSql = database.measurements;
    globalThis.fetch = createMeasuredFetch({
      fetch: originalFetch,
      origin: input.origin,
      runId: input.runId,
      sampleId: sample.id,
      startedAt: start,
      phase: () => phase,
      signal: input.signal,
      requests: sample.requests,
    });
    const sdk = createSdkHost(input.origin, sample.id, database.client);
    client = sdk;
    await measure("identity", () => sdk.identity.generate());
    const result = await measure("registration", async () => {
      const response = await sdk.session.registerIdentity();
      if (!response || "status" in response)
        throw new Error("Registration refused");
      return response;
    });
    sample.userId = result.userId;
    sample.organizationId = result.organizationId;
    await measure("login", async () => {
      if (!(await sdk.session.login(result.challenge)))
        throw new Error("Login failed");
    });
    await measure("logout", async () => {
      sample.sessionRevoked = await sdk.session.logoutRemote();
      if (!sample.sessionRevoked) throw new Error("Session cleanup failed");
    });
    sample.status = "passed";
  } catch {
    // Raw exceptions can contain tokens, request payloads, or key material.
    // HTTP status, phase, request IDs, and sanitized cost logs explain failures.
    sample.status = "failed";
    sample.failurePhase = phase;
    sample.userId ??= client?.session.userId ?? null;
    sample.organizationId ??= client?.session.organizationId ?? null;
  } finally {
    globalThis.fetch = originalFetch;
    try {
      client?.dispose();
    } finally {
      database?.close();
    }
  }
  return sample;
}
