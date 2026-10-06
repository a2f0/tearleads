import { MAX_MULTIPART_BLOB_PART_BYTES } from "@tearleads/validators/util";
import { createRequestLifetimeBindings } from "../../src/middleware/requestLifetime";
import { routeApp } from "../../src/routeApp";

/** Real HTTP proxy: abort upstream at the same deadline for every request. */
export function startPrincipalHistoryHttpProbe() {
  const metrics = {
    requests: 0,
    deadlineFailures: 0,
    maximumRequestMs: 0,
    maximumResponseBytes: 0,
    totalResponseBytes: 0,
    processPeakRssBytes: process.memoryUsage().rss,
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
    metrics.processPeakRssBytes = Math.max(
      metrics.processPeakRssBytes,
      process.memoryUsage().rss,
    );
  }, 10);
  const target = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: MAX_MULTIPART_BLOB_PART_BYTES,
    fetch: (request, server) =>
      routeApp.fetch(request, createRequestLifetimeBindings(request, server)),
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
    },
  };
}
