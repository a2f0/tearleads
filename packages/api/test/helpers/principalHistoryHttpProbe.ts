import { withDatabaseStatementCounter } from "@tearleads/api-shared/postgres";
import { MAX_MULTIPART_BLOB_PART_BYTES } from "@tearleads/validators/util";
import { createRequestLifetimeBindings } from "../../src/middleware/requestLifetime";
import { routeApp } from "../../src/routeApp";

/** Real HTTP proxy: abort upstream at the same deadline for every request. */
export function startPrincipalHistoryHttpProbe() {
  const initialMemory = process.memoryUsage();
  const metrics = {
    requests: 0,
    totalDatabaseStatements: 0,
    maximumDatabaseStatementsPerRequest: 0,
    deadlineFailures: 0,
    maximumRequestMs: 0,
    maximumResponseBytes: 0,
    totalResponseBytes: 0,
    processInitialRssBytes: initialMemory.rss,
    processPeakRssBytes: initialMemory.rss,
    processFinalRssBytes: initialMemory.rss,
    processInitialHeapUsedBytes: initialMemory.heapUsed,
    processPeakHeapUsedBytes: initialMemory.heapUsed,
    processFinalHeapUsedBytes: initialMemory.heapUsed,
    processMaximumEventLoopDelayMs: 0,
  };
  let previousTick = performance.now();
  const sampler = setInterval(() => {
    const now = performance.now();
    metrics.processMaximumEventLoopDelayMs = Math.max(
      metrics.processMaximumEventLoopDelayMs,
      now - previousTick - 10,
    );
    previousTick = now;
    const memory = process.memoryUsage();
    metrics.processPeakRssBytes = Math.max(
      metrics.processPeakRssBytes,
      memory.rss,
    );
    metrics.processPeakHeapUsedBytes = Math.max(
      metrics.processPeakHeapUsedBytes,
      memory.heapUsed,
    );
  }, 10);
  const target = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: MAX_MULTIPART_BLOB_PART_BYTES,
    async fetch(request, server) {
      const counter = { statements: 0 };
      try {
        return await withDatabaseStatementCounter(counter, () =>
          routeApp.fetch(
            request,
            createRequestLifetimeBindings(request, server),
          ),
        );
      } finally {
        metrics.totalDatabaseStatements += counter.statements;
        metrics.maximumDatabaseStatementsPerRequest = Math.max(
          metrics.maximumDatabaseStatementsPerRequest,
          counter.statements,
        );
      }
    },
  });
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: MAX_MULTIPART_BLOB_PART_BYTES,
    async fetch(request) {
      const started = performance.now();
      metrics.requests += 1;
      const deadline = AbortSignal.timeout(15_000);
      const signal = AbortSignal.any([request.signal, deadline]);
      try {
        const url = new URL(request.url);
        const response = await fetch(
          new URL(url.pathname + url.search, target.url),
          {
            method: request.method,
            headers: request.headers,
            body: request.body,
            signal,
          },
        );
        const bytes = await response.arrayBuffer();
        metrics.maximumResponseBytes = Math.max(
          metrics.maximumResponseBytes,
          bytes.byteLength,
        );
        metrics.totalResponseBytes += bytes.byteLength;
        const headers = new Headers(response.headers);
        headers.delete("Content-Encoding");
        headers.delete("Content-Length");
        return new Response(bytes, { status: response.status, headers });
      } catch (error) {
        if (!deadline.aborted) throw error;
        metrics.deadlineFailures += 1;
        return Response.json(
          { error: "Test proxy deadline exceeded" },
          { status: 504 },
        );
      } finally {
        metrics.maximumRequestMs = Math.max(
          metrics.maximumRequestMs,
          performance.now() - started,
        );
      }
    },
  });
  return {
    url: proxy.url,
    metrics,
    async stop() {
      clearInterval(sampler);
      await proxy.stop(true);
      await target.stop(true);
      const memory = process.memoryUsage();
      metrics.processFinalRssBytes = memory.rss;
      metrics.processFinalHeapUsedBytes = memory.heapUsed;
    },
  };
}
