import { createSession } from "../../src/middleware/session";
import { closeApiTestAdapters } from "../cleanup";
import { startPrincipalHistoryHttpProbe } from "./principalHistoryHttpProbe";
import type { PrincipalHistoryProbeMessage } from "./principalHistoryProbeProcessTypes";

// This executable receives only a registered fixture's public identity. Its
// private signing/KEM keys and the history-generating objects stay in the parent.
const identityKey = "PRINCIPAL_HISTORY_PROBE_IDENTITY";
const identity: unknown = JSON.parse(process.env[identityKey] ?? "null");
if (
  !identity ||
  typeof identity !== "object" ||
  !("userId" in identity) ||
  typeof identity.userId !== "string" ||
  !("fingerprint" in identity) ||
  typeof identity.fingerprint !== "string"
) {
  throw new Error("Expected the registered probe identity");
}
const token = await createSession({
  createdAt: Date.now(),
  userId: identity.userId,
  fingerprint: identity.fingerprint,
});
Bun.gc(true);
const initial = process.memoryUsage();
const server = startPrincipalHistoryHttpProbe();
function send(message: PrincipalHistoryProbeMessage) {
  if (!process.send) throw new Error("Expected a parent IPC channel");
  process.send(message);
}
send({ type: "ready", url: server.url.origin, token });

let stopping = false;
process.on("message", (message: unknown) => {
  if ((message !== "stop" && message !== "snapshot") || stopping) return;
  stopping = true;
  void (async () => {
    if (message === "stop") await server.stop();
    // Let completed HTTP callbacks release their temporary buffers before GC.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const beforeGc = process.memoryUsage();
    server.metrics.processFinalRssBytes = beforeGc.rss;
    server.metrics.processFinalHeapUsedBytes = beforeGc.heapUsed;
    Bun.gc(true);
    const retained = process.memoryUsage();
    send({
      type: "stopped",
      metrics: server.metrics,
      memory: {
        initialRssBytes: initial.rss,
        initialHeapUsedBytes: initial.heapUsed,
        retainedRssBytes: retained.rss,
        retainedHeapUsedBytes: retained.heapUsed,
      },
    });
    // The parent kills this process after the snapshot, without adapter shutdown.
    if (message === "snapshot") return;
    await closeApiTestAdapters();
    process.disconnect?.();
  })().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
    process.disconnect?.();
  });
});
