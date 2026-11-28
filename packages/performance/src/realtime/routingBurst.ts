import { createRealtimeGateway } from "@tearleads/api/test-runtime";

export interface RoutingBurstRow {
  readonly pathLength: number;
  readonly sockets: number;
  readonly hints: number;
  readonly deliveredFrames: number;
  readonly durationMs: number;
  readonly hintsPerSecond: number;
}

/**
 * Measures hub burst-routing throughput across path lengths and socket counts
 * under subtree-root coverage routing. Each socket installs one subtree root
 * (the path's top ancestor), and `hints` document-update events with a path of
 * length `pathLength` are routed synchronously in a tight burst.
 */
export async function measureRoutingBurst(input: {
  readonly hints?: number | undefined;
  readonly pathLengths?: readonly number[] | undefined;
  readonly socketCounts?: readonly number[] | undefined;
}): Promise<RoutingBurstRow[]> {
  const hints = input.hints ?? 1_000;
  const pathLengths = input.pathLengths ?? [4, 100];
  const socketCounts = input.socketCounts ?? [1, 100, 1_000];
  const rows: RoutingBurstRow[] = [];

  for (const pathLength of pathLengths) {
    const path = Array.from({ length: pathLength }, () => crypto.randomUUID());
    const rootId = path[0];
    const leafId = path.at(-1);
    if (!rootId || !leafId) continue;

    for (const socketCount of socketCounts) {
      let deliveredFrames = 0;
      const gateway = createRealtimeGateway({
        authorizeContainerAccess: async (_userId, ids) =>
          ids.map((id) => ({
            containerId: id,
            pathContainerIds: [id],
            principalKeys: [],
          })),
        revalidation: { intervalMs: 0 },
        subscribe: () => () => undefined,
        subscribeReconnect: () => () => undefined,
      });
      const sockets = Array.from({ length: socketCount }, (_, index) => ({
        close: () => undefined,
        data: { sessionId: `sess-${index}`, userId: `user-${index}` },
        send: () => {
          deliveredFrames++;
        },
      }));
      for (const ws of sockets) {
        gateway.websocket.open(ws);
        await gateway.websocket.message(
          ws,
          JSON.stringify({
            containerIds: [rootId],
            declarationId: `decl-${ws.data.sessionId}`,
            type: "known_containers",
          }),
        );
      }
      deliveredFrames = 0;

      const messages = Array.from({ length: hints }, (_, index) =>
        JSON.stringify({
          containerIds: [leafId],
          containerPaths: { [leafId]: path },
          documentId: `doc-${index}`,
          type: "document_update_created",
          updateIds: [`u-${index}`],
        }),
      );
      const started = performance.now();
      for (const message of messages) {
        await gateway.publish(message);
      }
      const durationMs = Math.max(
        0.1,
        Math.round((performance.now() - started) * 10) / 10,
      );
      gateway.stop();
      rows.push({
        deliveredFrames,
        durationMs,
        hints,
        hintsPerSecond: Math.round((hints * 1_000) / durationMs),
        pathLength,
        sockets: socketCount,
      });
    }
  }
  return rows;
}

if (import.meta.main) {
  const rows = await measureRoutingBurst({});
  console.log(JSON.stringify(rows, null, 2));
}
