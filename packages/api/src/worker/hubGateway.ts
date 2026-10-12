import type { createRealtimeGateway } from "../realtime/realtimeGateway";
import type { consumeWebSocketTicket } from "../realtime/wsTicket";
import type { HubAlarmScheduler } from "./hubAlarmScheduler";

export interface LoadedHubGateway {
  readonly gateway: ReturnType<typeof createRealtimeGateway>;
  readonly consumeTicket: typeof consumeWebSocketTicket;
  readonly report: (error: unknown) => void;
  readonly withDatabase: <T>(work: () => Promise<T>) => Promise<T>;
}

/** Runtime configuration is bound before importing database-dependent code. */
export async function loadHubGateway(
  scheduler: HubAlarmScheduler,
): Promise<LoadedHubGateway> {
  const [gatewayModule, ticketModule, diagnosticsModule, postgresModule] =
    await Promise.all([
      import("../realtime/realtimeGateway"),
      import("../realtime/wsTicket"),
      import("../diagnostics/reportBackgroundFailure"),
      import("@tearleads/api-shared/postgres"),
    ]);
  return {
    gateway: gatewayModule.createRealtimeGateway({
      revalidation: { schedule: scheduler.schedule },
      // A read in flight must time out inside this event, independently of
      // the next alarm. The timeout is removed when the read settles.
      scheduleReadTimeout: (callback, delayMs) => {
        const timer = setTimeout(() => {
          void callback();
        }, delayMs);
        return () => clearTimeout(timer);
      },
    }),
    consumeTicket: ticketModule.consumeWebSocketTicket,
    withDatabase: async (work) => {
      let closing: Promise<void> | undefined;
      try {
        return await postgresModule.withRequestScopedApiDatabase(
          work,
          (pending) => {
            closing = pending;
          },
        );
      } finally {
        await closing;
      }
    },
    report: (error) =>
      diagnosticsModule.reportBackgroundFailure(error, "websocket.event"),
  };
}
