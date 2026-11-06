import { ws } from "msw";
import { appTestRuntimeModuleUrl } from "./apiModuleUrls";
import { createMswEventRouter, type MswSocketClient } from "./eventRouter";

export const wsUrl = "ws://localhost:3002";

const eventsSocket = ws.link(wsUrl);
// Resolve the client's one-time ?ticket= through the same module-level store
// used by the proxied API; ticket minting already authenticated the session.
export const eventRouter = createMswEventRouter({
  resolveTicketIdentity: async (ticket) => {
    const { createWebSocketTicketConsumer } = (await import(
      appTestRuntimeModuleUrl
    )) as {
      createWebSocketTicketConsumer: (
        validateSession: (identity: {
          sessionId: string;
          userId: string;
        }) => Promise<boolean>,
      ) => (
        ticket: string,
      ) => Promise<{ sessionId: string; userId: string } | null>;
    };
    return createWebSocketTicketConsumer(async () => true)(ticket);
  },
});

interface ClosableConnection {
  close: (code?: number, reason?: string) => void;
}

function isClosableConnection(value: unknown): value is ClosableConnection {
  return (
    typeof value === "object" &&
    value !== null &&
    "close" in value &&
    typeof value.close === "function"
  );
}

async function waitForSocketClientsToDrain(timeoutMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (eventsSocket.clients.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function clearMswSocketClientStore(): void {
  if (typeof window === "undefined") {
    return;
  }

  // Reset MSW's WebSocket client manager in happy-dom/Bun.
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "msw/worker:stop" },
    }),
  );
}

export async function drainSocketClients(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));

  for (const client of eventsSocket.clients) {
    if (isClosableConnection(client)) {
      client.close();
    }
  }

  clearMswSocketClientStore();
  await waitForSocketClientsToDrain();
}

export const eventsSocketHandler = eventsSocket.addEventListener(
  "connection",
  ({ client }) => {
    eventRouter.handleConnection(client as MswSocketClient);
  },
);
